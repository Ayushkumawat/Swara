"""
Plivo ⇄ Gemini Live bridge — the path a real phone call takes.

    caller ──PSTN──▶ Plivo ──WebSocket (16 kHz PCM)──▶ this process ──▶ Gemini Live
                                                        │
                                                        └──HTTP──▶ Next.js console (/api/internal/telephony/*)
                                                                    who answers, the prompt, tool execution,
                                                                    transcript, billing

Derived from Plivo's Google-Live-API-Python sample, with the parts a product
needs on top of a demo:

  * the agent is chosen per call from the console (number → agent), not hard-coded
  * the model is driven through the google-genai SDK, not a raw socket, so
    resumption, goAway and tool calls are handled the same way as agent/live_session.py
  * function calls go to the console and come back with control signals:
    `end_call` hangs up after the closing line drains, `handoff_to_agent`
    swaps the persona mid-call, `transfer_to_human` dials the desk
  * outbound: POST /dial places a call and the answer URL carries the agent
  * every call is a row in the console — live transcript, minutes, tokens, cost

Run:
    cp .env.example .env   # fill in
    python bridge.py       # port 5000; expose with `ngrok http 5000`

See docs/telephony.md for the Plivo console setup.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import html
import json
import os
import secrets
import sys
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx
import plivo
from dotenv import load_dotenv
from google import genai
from google.genai import types
from quart import Quart, Response, request, websocket

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

# ── Config ─────────────────────────────────────────────────────────────────────

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
PLIVO_AUTH_ID = os.getenv("PLIVO_AUTH_ID", "")
PLIVO_AUTH_TOKEN = os.getenv("PLIVO_AUTH_TOKEN", "")
PLIVO_FROM_NUMBER = os.getenv("PLIVO_FROM_NUMBER", "")
# https://<your-ngrok>.ngrok.app — Plivo must reach this from the internet.
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
CONSOLE_URL = os.getenv("CONSOLE_URL", "http://127.0.0.1:3000").rstrip("/")
SHARED_SECRET = os.getenv("TELEPHONY_SHARED_SECRET", "")
PORT = int(os.getenv("PORT", "5000"))

SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
# 20 ms of 16 kHz PCM16 per model frame, as in the Plivo sample.
FRAME_BYTES = 20 * 16 * 2

CONNECTED_MARKER = "[CALL_CONNECTED]"
RECONNECTED_MARKER = "[CALL_RECONNECTED]"

# Identical to web/src/lib/live/config.ts and agent/live_session.py.
VAD_CONFIG = types.AutomaticActivityDetection(disabled=False, prefix_padding_ms=300, silence_duration_ms=700)
COMPRESSION_CONFIG = types.ContextWindowCompressionConfig(
    trigger_tokens=32000, sliding_window=types.SlidingWindow(target_tokens=16000)
)


def log(*parts: object) -> None:
    print(time.strftime("%H:%M:%S"), *parts, file=sys.stderr, flush=True)


# ── Console client ─────────────────────────────────────────────────────────────


class Console:
    """The console's internal telephony API. One place for the base URL and secret."""

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            base_url=f"{CONSOLE_URL}/api/internal/telephony",
            headers={"x-swara-internal": SHARED_SECRET, "content-type": "application/json"},
            timeout=httpx.Timeout(20.0, connect=5.0),
        )

    async def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        res = await self._http.post(f"/{path}", json=body)
        data: dict[str, Any] = res.json() if res.content else {}
        if res.status_code >= 400:
            raise RuntimeError(data.get("error") or f"console {path} → {res.status_code}")
        return data


console = Console()


# ── Session config ─────────────────────────────────────────────────────────────


def build_config(system_instruction: str, voice: str, tools: list[dict[str, Any]], resume_handle: str | None) -> types.LiveConnectConfig:
    declarations = [types.FunctionDeclaration.model_validate(d) for d in tools]
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))
        ),
        system_instruction=system_instruction,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(automatic_activity_detection=VAD_CONFIG),
        context_window_compression=COMPRESSION_CONFIG,
        # No thinking_config: gemini-3.8-live dropped thinking_level (reasoning
        # is interleaved) and rejects it in the setup message.
        tools=[types.Tool(function_declarations=declarations)] if declarations else None,
        session_resumption=types.SessionResumptionConfig(handle=resume_handle),
    )


# ── One phone call ─────────────────────────────────────────────────────────────


@dataclass
class Call:
    """Everything about one Plivo call leg, across any number of model sockets."""

    key: str
    plivo_uuid: str | None = None
    stream_id: str | None = None
    direction: str = "inbound"
    from_number: str = ""
    to_number: str = ""
    # Console-resolved session
    org_id: str = ""
    call_id: str | None = None
    agent_id: str | None = None
    agent_name: str = ""
    model: str = "gemini-3.8-live"  # overridden by the console's /session answer
    api_version: str = "v1alpha"
    system_instruction: str = ""
    voice: str = "Kore"
    tools: list[dict[str, Any]] = field(default_factory=list)
    # Runtime
    started_at: float = field(default_factory=time.monotonic)
    transcript: list[dict[str, str]] = field(default_factory=list)
    pending_role: str | None = None
    total_tokens: int = 0
    outcome: str | None = None
    resume_handle: str | None = None
    handoff_marker: str | None = None
    ending: bool = False
    bridged: bool = False  # human listen/takeover: stream may drop without ending the PSTN leg
    # Who the agent is connecting the caller to, while that transfer is in
    # flight. Set only for agent-initiated transfers; cleared once the
    # carrier's verdict (answered / rang out) has been passed to the console.
    transfer_to: str | None = None
    briefing: str | None = None
    campaign_id: str | None = None
    campaign_contact_id: str | None = None
    recording: bool = False
    # Checkpoint names we are waiting for Plivo to confirm as played.
    played: dict[str, asyncio.Event] = field(default_factory=dict)
    inbuffer: bytearray = field(default_factory=bytearray)


CALLS: dict[str, Call] = {}
CALLS_BY_ID: dict[str, Call] = {}
# Outbound dials pre-register their agent here, keyed by the token in the answer URL.
PENDING_DIALS: dict[str, dict[str, Any]] = {}
LISTEN_TOKENS: dict[str, str] = {}  # token → call.key
LISTENERS: dict[str, set[Any]] = {}

app = Quart(__name__)


def _plivo() -> plivo.RestClient:
    if not (PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN):
        raise RuntimeError("PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN not set")
    return plivo.RestClient(auth_id=PLIVO_AUTH_ID, auth_token=PLIVO_AUTH_TOKEN)


def _request_public_base() -> str | None:
    """Host Plivo just used. Prefer this over PUBLIC_URL so a stale ngrok
    domain in .env cannot send the audio stream to a tunnel that is gone."""
    host = (request.headers.get("X-Forwarded-Host") or request.host or "").split(",")[0].strip()
    if not host or host.startswith(("127.", "localhost", "0.0.0.0")):
        return None
    proto = request.headers.get("X-Forwarded-Proto", request.scheme) or "https"
    return f"{proto}://{host}"


def _public_ws(path: str, *, prefer_request: bool = False) -> str:
    if prefer_request:
        base = _request_public_base()
        if base:
            return base.replace("https://", "wss://").replace("http://", "ws://") + path
    if PUBLIC_URL:
        return PUBLIC_URL.replace("https://", "wss://").replace("http://", "ws://") + path
    proto = "wss" if request.headers.get("X-Forwarded-Proto", request.scheme) == "https" else "ws"
    return f"{proto}://{request.host}{path}"


def _public_http(path: str) -> str:
    if PUBLIC_URL:
        return PUBLIC_URL + path
    return f"{request.scheme}://{request.host}{path}"


def _internal_ok() -> bool:
    return not SHARED_SECRET or request.headers.get("x-swara-internal", "") == SHARED_SECRET


# ── Plivo webhooks ─────────────────────────────────────────────────────────────


@app.route("/health")
async def health() -> Response:
    return Response(json.dumps({"ok": True, "calls": len(CALLS)}), mimetype="application/json")


@app.route("/plivo/answer", methods=["GET", "POST"])
async def answer() -> Response:
    """Plivo asks what to do with a call that just connected. Answer: stream it here."""
    form = await request.form
    params = {**request.args.to_dict(), **form.to_dict()}
    key = secrets.token_urlsafe(8)
    call = Call(
        key=key,
        plivo_uuid=params.get("CallUUID"),
        direction="outbound" if params.get("Direction", "inbound") == "outbound" else "inbound",
        from_number=params.get("From", ""),
        to_number=params.get("To", ""),
    )
    dial = PENDING_DIALS.pop(params.get("dial", ""), None)
    if dial:
        call.direction = "outbound"
        call.agent_id = dial.get("agentId")
        call.org_id = dial.get("orgId", "")
        call.to_number = dial.get("to", call.to_number)
        call.briefing = dial.get("briefing")
        call.campaign_id = dial.get("campaignId")
        call.campaign_contact_id = dial.get("campaignContactId")
    CALLS[key] = call
    log(f"[{key}] answer {call.direction} from={call.from_number} to={call.to_number} uuid={call.plivo_uuid}")

    ws_url = _public_ws(f"/media-stream/{key}", prefer_request=True)
    log(f"[{key}] stream url {ws_url}")
    # Single-line Stream tag: Plivo's XML parser has rejected split attribute
    # lines as "Invalid Answer XML" (hangup 8011) in the past.
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        '<Stream bidirectional="true" keepCallAlive="true" streamTimeout="86400" '
        f'contentType="audio/x-l16;rate=16000" audioTrack="inbound">{ws_url}</Stream>'
        "</Response>"
    )
    return Response(xml, mimetype="text/xml")


@app.route("/plivo/hangup", methods=["GET", "POST"])
async def hangup() -> Response:
    form = await request.form
    params = {**request.args.to_dict(), **form.to_dict()}
    uuid = params.get("CallUUID")
    for call in list(CALLS.values()):
        if call.plivo_uuid == uuid:
            log(f"[{call.key}] hangup webhook ({params.get('HangupCause', '?')})")
            await finish(call, params.get("HangupCause"))
    return Response("", status=204)


@app.route("/plivo/transfer", methods=["GET", "POST"])
async def transfer_xml() -> Response:
    """Answer XML for a warm transfer: bridge the caller to a human desk."""
    to = request.args.get("to", "")
    caller_id = request.args.get("callerId", PLIVO_FROM_NUMBER)
    conference = request.args.get("conference", "")
    if conference:
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Conference startConferenceOnEnter="true" endConferenceOnExit="false">{conference}</Conference>
</Response>"""
        return Response(xml, mimetype="application/xml")
    # `action` is where Plivo goes when the dial is over, with DialStatus
    # saying how it ended. That is how we learn a transfer rang out — and how
    # the caller stops hearing "could not be reached" after a transfer that
    # was answered and simply finished.
    call_id = request.args.get("call", "")
    action = ""
    if call_id:
        result_url = _public_http_abs("/plivo/transfer-result?" + urlencode({"call": call_id}))
        action = f' action="{html.escape(result_url, quote=True)}" method="POST"'
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="{html.escape(caller_id, quote=True)}" timeout="30"{action}><Number>{html.escape(to)}</Number></Dial>
  <Speak>{MISSED_TRANSFER_LINE}</Speak>
</Response>"""
    return Response(xml, mimetype="application/xml")


# Spoken by the carrier, not the model, so it is one fixed line. It promises
# only what is certain: the request is on record and a callback follows.
MISSED_TRANSFER_LINE = "Sorry, they could not take the call right now. Your request has been noted and you will get a call back shortly."
# What Plivo reports in DialStatus when the person did not end up on the call.
NOT_ANSWERED = {"busy", "failed", "timeout", "no-answer", "cancel"}


@app.route("/plivo/transfer-result", methods=["GET", "POST"])
async def transfer_result() -> Response:
    """Plivo tells us how a warm transfer's dial ended; say the right thing next."""
    form = await request.form
    params = {**request.args.to_dict(), **form.to_dict()}
    status = str(params.get("DialStatus") or "").strip().lower()
    call_id = params.get("call", "")
    # Trust our own record of the call, not the query string: only a call
    # this bridge is transferring right now can report a result.
    call = CALLS_BY_ID.get(call_id) or next((c for c in CALLS.values() if c.call_id == call_id), None)
    log(f"[{call.key if call else call_id}] transfer result DialStatus={status or '?'} hangup={params.get('DialHangupCause', '?')}")

    missed = status in NOT_ANSWERED
    if call and call.call_id and call.transfer_to is not None and (missed or status == "completed"):
        name, call.transfer_to = call.transfer_to, None
        try:
            await console.post("transfer-result", compact({
                "orgId": call.org_id,
                "callId": call.call_id,
                "answered": not missed,
                "name": name or None,
                "status": status,
            }))
        except Exception as exc:  # noqa: BLE001
            log(f"[{call.key}] could not report transfer result: {exc}")

    if missed:
        body = f"<Speak>{MISSED_TRANSFER_LINE}</Speak><Hangup/>"
    else:
        # Answered and finished (or a status we do not recognise): nothing
        # more to say to the caller.
        body = "<Hangup/>"
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>', mimetype="application/xml")


# ── Outbound ───────────────────────────────────────────────────────────────────


@app.route("/dial", methods=["POST"])
async def dial() -> Response:
    """The console asks us to call someone with a given agent."""
    if not _internal_ok():
        return Response(json.dumps({"error": "unauthorised"}), status=401, mimetype="application/json")
    body = await request.get_json(force=True, silent=True) or {}
    to = str(body.get("to", "")).strip()
    agent_id = body.get("agentId")
    org_id = body.get("orgId")
    from_number = body.get("from") or PLIVO_FROM_NUMBER
    if not (to and agent_id and from_number):
        return Response(json.dumps({"error": "to, agentId and a from number are required"}), status=400, mimetype="application/json")
    if not PUBLIC_URL:
        return Response(json.dumps({"error": "PUBLIC_URL is not set on the bridge; Plivo cannot reach it"}), status=503, mimetype="application/json")

    token = secrets.token_urlsafe(8)
    PENDING_DIALS[token] = {
        "agentId": agent_id,
        "orgId": org_id,
        "to": to,
        "briefing": body.get("briefing"),
        "campaignId": body.get("campaignId"),
        "campaignContactId": body.get("campaignContactId"),
    }
    answer_url = _public_http("/plivo/answer?" + urlencode({"dial": token}))
    try:
        client = _plivo()
        kwargs: dict[str, Any] = dict(
            from_=_e164_digits(from_number),
            to_=_e164_digits(to),
            answer_url=answer_url,
            answer_method="POST",
            hangup_url=_public_http("/plivo/hangup"),
            hangup_method="POST",
        )
        if body.get("machineDetection"):
            kwargs["machine_detection"] = "true"
            kwargs["machine_detection_time"] = 5000
            kwargs["machine_detection_url"] = _public_http("/plivo/machine")
            kwargs["machine_detection_method"] = "POST"
        made = await asyncio.to_thread(client.calls.create, **kwargs)
        uuid = getattr(made, "request_uuid", None) or getattr(made, "message", None)
        log(f"dial → {to} agent={agent_id} request={uuid}")
        return Response(json.dumps({"ok": True, "requestUuid": str(uuid)}), mimetype="application/json")
    except Exception as exc:  # noqa: BLE001
        PENDING_DIALS.pop(token, None)
        return Response(json.dumps({"error": f"Plivo rejected the call: {exc}"}), status=502, mimetype="application/json")


@app.route("/plivo/machine", methods=["GET", "POST"])
async def machine() -> Response:
    """AMD: hang up voicemail so we do not burn minutes talking to a machine."""
    form = await request.form
    params = {**request.args.to_dict(), **form.to_dict()}
    uuid = params.get("CallUUID")
    machine_type = (params.get("Machine") or params.get("MachineType") or "").lower()
    is_machine = machine_type in {"true", "1", "machine", "voicemail"} or params.get("Machine") == "true"
    log(f"amd uuid={uuid} machine={params.get('Machine')} type={machine_type}")
    if not (uuid and is_machine):
        return Response("", status=204)
    for call in list(CALLS.values()):
        if call.plivo_uuid == uuid:
            call.outcome = "voicemail"
            call.ending = True
            await hangup_leg(call)
            break
    return Response("", status=204)


@app.route("/plivo/recording", methods=["GET", "POST"])
async def recording_callback() -> Response:
    form = await request.form
    params = {**request.args.to_dict(), **form.to_dict()}
    uuid = params.get("CallUUID")
    url = params.get("RecordUrl") or params.get("recordingUrl") or ""
    duration = params.get("RecordingDuration") or params.get("recordingDuration")
    call = next((c for c in CALLS.values() if c.plivo_uuid == uuid), None)
    org_id = (call.org_id if call else params.get("org")) or ""
    call_id = (call.call_id if call else params.get("call")) or ""
    if call_id and org_id and url:
        with contextlib.suppress(Exception):
            await console.post("recording", compact({
                "orgId": org_id,
                "callId": call_id,
                "url": url,
                "durationSec": int(float(duration)) if duration else None,
            }))
            log(f"recording saved call={call_id}")
    return Response("", status=204)


@app.route("/listen-grant", methods=["POST"])
async def listen_grant() -> Response:
    if not _internal_ok():
        return Response(json.dumps({"error": "unauthorised"}), status=401, mimetype="application/json")
    body = await request.get_json(force=True, silent=True) or {}
    call_id = str(body.get("callId") or "")
    call = CALLS_BY_ID.get(call_id) or next((c for c in CALLS.values() if c.call_id == call_id), None)
    if not call:
        return Response(json.dumps({"error": "That call is not live on this bridge"}), status=404, mimetype="application/json")
    token = secrets.token_urlsafe(16)
    LISTEN_TOKENS[token] = call.key
    ws = _public_ws(f"/supervisor/{token}")
    return Response(json.dumps({"ok": True, "wsUrl": ws, "token": token}), mimetype="application/json")


@app.route("/intervene", methods=["POST"])
async def intervene() -> Response:
    if not _internal_ok():
        return Response(json.dumps({"error": "unauthorised"}), status=401, mimetype="application/json")
    body = await request.get_json(force=True, silent=True) or {}
    call_id = str(body.get("callId") or "")
    action = str(body.get("action") or "")
    phone = str(body.get("phone") or "").replace(" ", "")
    call = CALLS_BY_ID.get(call_id) or next((c for c in CALLS.values() if c.call_id == call_id), None)
    if not call or not call.plivo_uuid:
        return Response(json.dumps({"error": "Call is not on this bridge"}), status=404, mimetype="application/json")
    if not phone:
        return Response(json.dumps({"error": "phone required"}), status=400, mimetype="application/json")
    try:
        if action == "takeover":
            await takeover_call(call, phone)
        else:
            # A supervisor chose this number by hand; there is no listed
            # person to inform if it rings out.
            await transfer_after_drain(call, None, {"phone": phone, "name": "supervisor", "report": False})
        return Response(json.dumps({"ok": True}), mimetype="application/json")
    except Exception as exc:  # noqa: BLE001
        return Response(json.dumps({"error": str(exc)}), status=502, mimetype="application/json")


@app.route("/notify", methods=["POST"])
async def notify_route() -> Response:
    if not _internal_ok():
        return Response(json.dumps({"error": "unauthorised"}), status=401, mimetype="application/json")
    body = await request.get_json(force=True, silent=True) or {}
    channel = str(body.get("channel") or "sms")
    to = str(body.get("to") or "").replace("+", "")
    text = str(body.get("text") or "")
    if not (to and text):
        return Response(json.dumps({"error": "to and text required"}), status=400, mimetype="application/json")
    try:
        client = _plivo()
        kwargs: dict[str, Any] = dict(src=PLIVO_FROM_NUMBER.replace("+", ""), dst=to, text=text)
        if channel == "whatsapp":
            kwargs["type"] = "whatsapp"
        await asyncio.to_thread(client.messages.create, **kwargs)
        return Response(json.dumps({"ok": True}), mimetype="application/json")
    except Exception as exc:  # noqa: BLE001
        return Response(json.dumps({"error": str(exc)}), status=502, mimetype="application/json")


@app.websocket("/supervisor/<token>")
async def supervisor(token: str) -> None:
    key = LISTEN_TOKENS.get(token)
    await websocket.accept()
    if not key or key not in CALLS:
        await websocket.close(1008)
        return
    bucket = LISTENERS.setdefault(key, set())
    sock = websocket._get_current_object()  # noqa: SLF001
    bucket.add(sock)
    log(f"[{key}] supervisor joined ({len(bucket)} listening)")
    try:
        while True:
            await websocket.receive()
    except Exception:  # noqa: BLE001
        pass
    finally:
        bucket.discard(sock)
        if not bucket:
            LISTENERS.pop(key, None)


# ── Media stream ───────────────────────────────────────────────────────────────


@app.websocket("/media-stream/<key>")
async def media_stream(key: str) -> None:
    call = CALLS.get(key)
    await websocket.accept()
    if call is None:
        log(f"[{key}] stream for unknown call; closing")
        await websocket.close(1008)
        return
    log(f"[{key}] plivo stream connected")

    try:
        session = await console.post("session", compact({
            "to": call.to_number,
            "from": call.from_number,
            "direction": call.direction,
            "plivoCallUuid": call.plivo_uuid,
            "agentId": call.agent_id,
            "orgId": call.org_id,
            "briefing": call.briefing,
            "campaignId": call.campaign_id,
            "campaignContactId": call.campaign_contact_id,
        }))
        apply_session(call, session)
    except Exception as exc:  # noqa: BLE001
        log(f"[{key}] console session failed: {exc}")
        await say_and_hangup(call, "Sorry, this line is not set up yet. Please try again later.")
        await websocket.close(1011)
        return

    plivo_ws = websocket._get_current_object()  # noqa: SLF001 - Quart's context proxy is not awaitable across tasks
    model_task = asyncio.create_task(run_model(call, plivo_ws))
    try:
        await receive_from_plivo(call, plivo_ws, model_task)
    finally:
        model_task.cancel()
        with contextlib.suppress(BaseException):
            await model_task
        if not call.bridged:
            await finish(call)


def compact(body: dict[str, Any]) -> dict[str, Any]:
    """Drop empty values; the console's schema treats null as a type error, not absence."""
    return {k: v for k, v in body.items() if v not in (None, "")}


def apply_session(call: Call, session: dict[str, Any]) -> None:
    call.org_id = session["orgId"]
    call.call_id = session["callId"]
    call.agent_id = session["agentId"]
    call.agent_name = session["agent"]["name"]
    call.model = session.get("model", call.model)
    call.api_version = session.get("apiVersion", call.api_version)
    call.system_instruction = session["systemInstruction"]
    call.voice = session.get("voice") or call.voice
    call.tools = session.get("tools", [])
    if call.call_id:
        CALLS_BY_ID[call.call_id] = call


async def receive_from_plivo(call: Call, plivo_ws: Any, model_task: asyncio.Task[None]) -> None:
    """Plivo → us: PCM frames in, plus stream lifecycle and checkpoint acks."""
    while True:
        raw = await plivo_ws.receive()
        data = json.loads(raw)
        event = data.get("event")
        if event == "start":
            call.stream_id = data["start"].get("streamId")
            call.plivo_uuid = data["start"].get("callId", call.plivo_uuid)
            log(f"[{call.key}] stream start id={call.stream_id}")
            asyncio.create_task(start_recording(call))
        elif event == "media":
            payload = data["media"]["payload"]
            call.inbuffer.extend(base64.b64decode(payload))
            await fanout_listen(call, payload, SEND_SAMPLE_RATE)
        elif event == "playedStream":
            ev = call.played.get(data.get("name", ""))
            if ev:
                ev.set()
        elif event == "dtmf":
            log(f"[{call.key}] dtmf {data.get('dtmf', {}).get('digit')}")
        elif event == "stop":
            log(f"[{call.key}] stream stop")
            return
        if model_task.done():
            return


async def run_model(call: Call, plivo_ws: Any) -> None:
    """Hold the model conversation open across reconnects and handoffs."""
    client = genai.Client(api_key=GEMINI_API_KEY, http_options={"api_version": call.api_version})
    reconnects = 0

    while not call.ending:
        resuming = call.resume_handle is not None
        handoff = call.handoff_marker
        call.handoff_marker = None
        config = build_config(call.system_instruction, call.voice, call.tools, call.resume_handle)
        reconnect = asyncio.Event()

        try:
            async with client.aio.live.connect(model=call.model, config=config) as session:
                log(f"[{call.key}] model {'handoff→' + call.agent_name if handoff else 'resumed' if resuming else 'connected'} voice={call.voice}")
                await session.send_realtime_input(
                    text=handoff if handoff else RECONNECTED_MARKER if resuming else CONNECTED_MARKER
                )
                tasks = {
                    asyncio.create_task(pump_audio(call, session)),
                    asyncio.create_task(receive_from_model(call, session, plivo_ws, reconnect)),
                    asyncio.create_task(reconnect.wait()),
                }
                try:
                    done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for t in done:
                        exc = t.exception() if not t.cancelled() else None
                        if exc and not isinstance(exc, asyncio.CancelledError):
                            raise exc
                finally:
                    # Whether we leave by a finished task or by being cancelled
                    # from the Plivo side, collect the others: a socket-closed
                    # error raised during teardown must not be left unretrieved.
                    for t in tasks:
                        t.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            if call.ending:
                break
            log(f"[{call.key}] model error: {exc}")

        if call.ending:
            break
        if call.handoff_marker:
            reconnects = 0
            continue  # fresh persona, no resume
        if call.resume_handle is None:
            log(f"[{call.key}] no resume handle; ending")
            break
        reconnects += 1
        if reconnects > 5:
            break
        await asyncio.sleep(0.25 * reconnects)

    await finish_leg(call)


async def pump_audio(call: Call, session: Any) -> None:
    """Forward 20 ms frames the moment they are complete; drop backlog rather than lag."""
    while True:
        if len(call.inbuffer) >= FRAME_BYTES:
            if len(call.inbuffer) > FRAME_BYTES * 25:  # >500 ms behind: the model would answer stale audio
                del call.inbuffer[:-FRAME_BYTES * 5]
            chunk = bytes(call.inbuffer[:FRAME_BYTES])
            del call.inbuffer[:FRAME_BYTES]
            await session.send_realtime_input(audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={SEND_SAMPLE_RATE}"))
        else:
            await asyncio.sleep(0.005)


async def receive_from_model(call: Call, session: Any, plivo_ws: Any, reconnect: asyncio.Event) -> None:
    # The SDK's receive() iterator ends at every turn_complete, so it has to be
    # re-entered for the next turn; treating its end as "socket closed" would
    # reconnect after every sentence.
    while not reconnect.is_set():
        async for message in session.receive():
            await handle_model_message(call, session, plivo_ws, reconnect, message)
            if reconnect.is_set():
                return


async def handle_model_message(call: Call, session: Any, plivo_ws: Any, reconnect: asyncio.Event, message: Any) -> None:
    update = getattr(message, "session_resumption_update", None)
    if update is not None and update.resumable and update.new_handle:
        call.resume_handle = update.new_handle

    if getattr(message, "go_away", None) is not None:
        log(f"[{call.key}] goAway; reconnecting")
        reconnect.set()
        return

    usage = getattr(message, "usage_metadata", None)
    if usage is not None and usage.total_token_count:
        call.total_tokens = usage.total_token_count

    tool_call = getattr(message, "tool_call", None)
    if tool_call is not None and tool_call.function_calls:
        await handle_tool_calls(call, session, plivo_ws, tool_call.function_calls, reconnect)
        return

    content = getattr(message, "server_content", None)
    if content is None:
        return

    if content.interrupted:
        call.pending_role = None
        await plivo_send(plivo_ws, {"event": "clearAudio", "stream_id": call.stream_id})
        return

    if getattr(content, "input_transcription", None) and content.input_transcription.text:
        append_turn(call, "caller", content.input_transcription.text)
    if getattr(content, "output_transcription", None) and content.output_transcription.text:
        append_turn(call, "agent", content.output_transcription.text)

    if content.model_turn is not None:
        for part in content.model_turn.parts:
            inline = part.inline_data
            if inline and inline.mime_type and inline.mime_type.startswith("audio/pcm") and inline.data:
                payload = base64.b64encode(inline.data).decode()
                await plivo_send(
                    plivo_ws,
                    {
                        "event": "playAudio",
                        "media": {
                            "contentType": "audio/x-l16",
                            "sampleRate": RECEIVE_SAMPLE_RATE,
                            "payload": payload,
                        },
                    },
                )
                await fanout_listen(call, payload, RECEIVE_SAMPLE_RATE)

    if content.turn_complete:
        call.pending_role = None
        asyncio.create_task(push_transcript(call))


def _is_async_tool(call: Call, name: str) -> bool:
    for d in call.tools:
        if d.get("name") == name:
            return str(d.get("behavior") or "").upper() == "NON_BLOCKING"
    return False


async def handle_tool_calls(call: Call, session: Any, plivo_ws: Any, calls: list[Any], reconnect: asyncio.Event) -> None:
    responses: list[types.FunctionResponse] = []
    controls: list[dict[str, Any]] = []
    for fc in calls:
        name = fc.name or "tool"
        args = dict(fc.args or {})
        log(f"[{call.key}] tool {name} {json.dumps(args)[:160]}")
        try:
            data = await console.post("tool", {"orgId": call.org_id, "callId": call.call_id, "name": name, "args": args})
            result = dict(data.get("result") or {})
        except Exception as exc:  # noqa: BLE001
            result = {"error": f"Tool failed: {exc}"}
        control = result.pop("__control", None)
        result.pop("__plan", None)
        if control:
            controls.append(control)
        # The console tags lookups NON_BLOCKING so the agent keeps talking
        # while they run; the response then says when the result may be
        # spoken. WHEN_IDLE = once the caller has stopped talking.
        scheduling = (
            types.FunctionResponseScheduling.WHEN_IDLE if _is_async_tool(call, name) else None
        )
        responses.append(
            types.FunctionResponse(id=fc.id, name=name, response=result, scheduling=scheduling)
        )
    await session.send_tool_response(function_responses=responses)

    for control in controls:
        kind = control.get("kind")
        if kind == "end":
            call.outcome = control.get("outcome") or "resolved"
            asyncio.create_task(end_after_drain(call, plivo_ws, reconnect))
        elif kind == "handoff":
            asyncio.create_task(handoff_after_drain(call, plivo_ws, reconnect, control))
        elif kind == "transfer":
            call.outcome = "escalated"
            asyncio.create_task(transfer_after_drain(call, plivo_ws, control))


async def drain(call: Call, plivo_ws: Any, settle_s: float = 2.5, max_s: float = 12.0) -> None:
    """Wait for the closing line to finish playing on the phone.

    The model streams the sentence *after* the tool result, so we give it a
    moment to produce audio, then ask Plivo to confirm playback with a
    checkpoint. Plivo answers `playedStream` once everything queued before the
    checkpoint has left the speaker.
    """
    await asyncio.sleep(settle_s)
    name = f"cp_{secrets.token_hex(4)}"
    ev = asyncio.Event()
    call.played[name] = ev
    await plivo_send(plivo_ws, {"event": "checkpoint", "streamId": call.stream_id, "name": name})
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(ev.wait(), timeout=max_s)
    call.played.pop(name, None)


async def end_after_drain(call: Call, plivo_ws: Any, reconnect: asyncio.Event) -> None:
    await drain(call, plivo_ws)
    call.ending = True
    reconnect.set()
    await hangup_leg(call)


async def handoff_after_drain(call: Call, plivo_ws: Any, reconnect: asyncio.Event, control: dict[str, Any]) -> None:
    await drain(call, plivo_ws, settle_s=2.0, max_s=8.0)
    try:
        session = await console.post("session", compact({
            "orgId": call.org_id, "agentId": control.get("agentId"), "callId": call.call_id,
            "handoff": True, "direction": call.direction,
        }))
    except Exception as exc:  # noqa: BLE001
        log(f"[{call.key}] handoff failed: {exc}")
        return
    previous = call.agent_name
    apply_session(call, session)
    summary = control.get("summary") or "no summary given"
    call.handoff_marker = f"[HANDOFF: from {previous}. Caller summary: {summary}]"
    call.resume_handle = None  # new persona, new conversation
    log(f"[{call.key}] handoff {previous} → {call.agent_name}")
    reconnect.set()


def _e164_digits(raw: str) -> str:
    """Plivo requires country-prefixed digits without '+'. Default 10-digit numbers to +91."""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) == 10:
        return f"91{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"91{digits[1:]}"
    return digits


async def transfer_after_drain(call: Call, plivo_ws: Any, control: dict[str, Any]) -> None:
    if plivo_ws is not None:
        await drain(call, plivo_ws)
    to = _e164_digits(str(control.get("phone", "")))
    if not (call.plivo_uuid and to):
        return
    call.bridged = True
    call.ending = True
    call.transfer_to = str(control.get("name") or "") if control.get("report", True) else None
    url = _public_http_abs("/plivo/transfer?" + urlencode(compact({
        "to": to,
        "callerId": _e164_digits(PLIVO_FROM_NUMBER),
        "call": call.call_id,
    })))
    try:
        client = _plivo()
        await asyncio.to_thread(client.calls.transfer, call.plivo_uuid, legs="aleg", aleg_url=url, aleg_method="GET")
        log(f"[{call.key}] transferred to {control.get('name')} {to}")
    except Exception as exc:  # noqa: BLE001
        log(f"[{call.key}] transfer failed: {exc}")
        call.bridged = False
        call.transfer_to = None


def _public_http_abs(path: str) -> str:
    return (PUBLIC_URL or f"http://127.0.0.1:{PORT}") + path


async def hangup_leg(call: Call) -> None:
    if not call.plivo_uuid:
        return
    try:
        client = _plivo()
        await asyncio.to_thread(client.calls.delete, call.plivo_uuid)
        log(f"[{call.key}] hung up")
    except Exception as exc:  # noqa: BLE001
        log(f"[{call.key}] hangup failed: {exc}")


async def say_and_hangup(call: Call, text: str) -> None:
    """Fallback when the console cannot serve a session: speak once, hang up."""
    if not call.plivo_uuid:
        return
    with contextlib.suppress(Exception):
        client = _plivo()
        await asyncio.to_thread(client.calls.speak, call.plivo_uuid, text)
        await asyncio.sleep(4)
        await asyncio.to_thread(client.calls.delete, call.plivo_uuid)


async def start_recording(call: Call) -> None:
    if call.recording or not call.plivo_uuid:
        return
    call.recording = True
    try:
        client = _plivo()
        await asyncio.to_thread(
            client.calls.record,
            call.plivo_uuid,
            time_limit=14400,
            file_format="mp3",
            callback_url=_public_http_abs(
                "/plivo/recording?" + urlencode({"call": call.call_id or "", "org": call.org_id})
            ),
            callback_method="POST",
        )
        log(f"[{call.key}] recording started")
    except Exception as exc:  # noqa: BLE001
        call.recording = False
        log(f"[{call.key}] record start failed: {exc}")


async def fanout_listen(call: Call, payload_b64: str, sample_rate: int) -> None:
    listeners = LISTENERS.get(call.key)
    if not listeners:
        return
    frame = json.dumps({"event": "media", "sampleRate": sample_rate, "payload": payload_b64})
    dead: list[Any] = []
    for sock in list(listeners):
        try:
            await sock.send(frame)
        except Exception:  # noqa: BLE001
            dead.append(sock)
    for sock in dead:
        listeners.discard(sock)


async def takeover_call(call: Call, phone: str) -> None:
    """Mute the model and drop the A-leg into a conference with the supervisor."""
    if not call.plivo_uuid:
        raise RuntimeError("no plivo uuid")
    call.bridged = True
    call.ending = True
    call.outcome = "escalated"
    conf = f"swara-{call.call_id or call.key}"
    url = _public_http_abs("/plivo/transfer?" + urlencode({"conference": conf}))
    client = _plivo()
    await asyncio.to_thread(client.calls.transfer, call.plivo_uuid, legs="aleg", aleg_url=url, aleg_method="GET")
    await asyncio.to_thread(
        client.calls.create,
        from_=_e164_digits(PLIVO_FROM_NUMBER),
        to_=_e164_digits(phone),
        answer_url=url,
        answer_method="GET",
    )
    log(f"[{call.key}] takeover conference {conf} → {phone}")


async def plivo_send(plivo_ws: Any, payload: dict[str, Any]) -> None:
    with contextlib.suppress(Exception):
        await plivo_ws.send(json.dumps(payload))


def append_turn(call: Call, role: str, text: str) -> None:
    if call.pending_role == role and call.transcript and call.transcript[-1]["role"] == role:
        call.transcript[-1]["text"] += text
    else:
        call.transcript.append({"role": role, "text": text})
        call.pending_role = role


async def push_transcript(call: Call) -> None:
    if not call.call_id:
        return
    with contextlib.suppress(Exception):
        await console.post("transcript", {"orgId": call.org_id, "callId": call.call_id, "transcript": call.transcript})


async def finish_leg(call: Call) -> None:
    """Model loop ended for good; the Plivo leg follows if it is still up."""
    if not call.ending:
        call.ending = True
        await hangup_leg(call)


_finished: set[str] = set()


async def finish(call: Call, hangup_cause: str | None = None) -> None:
    """Bill the call once, whichever side noticed the end first."""
    if call.key in _finished:
        return
    _finished.add(call.key)
    CALLS.pop(call.key, None)
    if call.call_id:
        CALLS_BY_ID.pop(call.call_id, None)
    LISTENERS.pop(call.key, None)
    call.ending = True
    if not call.call_id:
        return
    duration = int(time.monotonic() - call.started_at)
    outcome = call.outcome or ("dropped" if hangup_cause and "NORMAL" not in hangup_cause.upper() else None)
    try:
        await console.post("complete", compact({
            "orgId": call.org_id,
            "callId": call.call_id,
            "durationSec": duration,
            "tokens": call.total_tokens,
            "transcript": call.transcript,
            "outcome": outcome,
        }))
        log(f"[{call.key}] completed {duration}s {call.total_tokens} tokens outcome={outcome}")
    except Exception as exc:  # noqa: BLE001
        log(f"[{call.key}] completion failed: {exc}")


# ── Entrypoint ─────────────────────────────────────────────────────────────────


def check_env() -> None:
    missing = [k for k, v in {"GEMINI_API_KEY": GEMINI_API_KEY, "PLIVO_AUTH_ID": PLIVO_AUTH_ID, "PLIVO_AUTH_TOKEN": PLIVO_AUTH_TOKEN}.items() if not v]
    if missing:
        log("missing env:", ", ".join(missing), "— see telephony/.env.example")
    if not PUBLIC_URL:
        log("PUBLIC_URL not set: inbound works only if Plivo can reach request.host; outbound /dial is disabled")
    log(f"console at {CONSOLE_URL}; listening on :{PORT}")


if __name__ == "__main__":
    check_env()
    app.run(host="0.0.0.0", port=PORT)
