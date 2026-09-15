"""
Server-side live voice session — the path a real phone call takes.

Why this exists alongside the browser client
--------------------------------------------
The browser client (web/src/lib/live/) is the lowest-latency option for audio
that *originates in a browser*: it opens its own socket to Google and skips our
server entirely. But a customer calling a phone number is not in a browser. That
audio arrives from the carrier over SIP at infrastructure we run, so the model
socket has to live next to the SIP leg. Same model, same config, different owner
of the socket.

So: browser client for the in-app test bench and any web/app voice widget,
this module for telephony. Both read the same session parameters (see
`web/src/lib/live/config.ts`) so an agent behaves identically wherever it runs.

What this adds over the original prototype
------------------------------------------
* API key from the environment instead of a literal in the source.
* Context window compression, so a call is not capped at ~15 minutes.
* Session resumption, so the ~10-minute connection ceiling and network blips
  do not end a conversation.
* `goAway` handling: reconnect on the 60-second warning, while the old socket
  still works, so the swap lands between turns instead of mid-word.
* VAD tuned for Indian callers who pause while switching languages.
* Turn-level transcript and token accounting, which is what per-minute billing
  and QA scoring are built from.

Run the interactive microphone version:

    export GEMINI_API_KEY=...
    python -m agent.live_session --agent grievance

Or drive it from your own audio source (a SIP bridge) by constructing
`LiveSession` and calling `send_audio` / consuming `on_audio`.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import sys
import traceback
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal

from google import genai
from google.genai import types

from .prompts import AGENT_PROMPTS, language_directive

# ── Session parameters. Mirror of web/src/lib/live/config.ts ────────────────

MODEL = "gemini-3.1-flash-live-preview"

# Session resumption and the newer native-audio switches are only served on
# v1alpha. v1beta connects fine but silently omits resumption updates, which
# looks like "resumption is broken" rather than "wrong API version".
API_VERSION = "v1alpha"

SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024  # 64 ms at 16 kHz.

DEFAULT_VOICE = "Orus"

# Markers the persona is told to react to (see prompts.CALL_CRAFT). Sent as
# realtime text rather than conversation history so they never show up as
# something the caller said.
CONNECTED_MARKER = "[CALL_CONNECTED]"
RECONNECTED_MARKER = "[CALL_RECONNECTED]"

# See the TypeScript config for the reasoning behind each of these; the values
# are deliberately identical.
VAD_CONFIG = types.AutomaticActivityDetection(
    disabled=False,
    prefix_padding_ms=300,
    silence_duration_ms=700,
)

COMPRESSION_CONFIG = types.ContextWindowCompressionConfig(
    trigger_tokens=32000,
    sliding_window=types.SlidingWindow(target_tokens=16000),
)


def build_config(
    system_instruction: str,
    voice: str = DEFAULT_VOICE,
    resume_handle: str | None = None,
) -> types.LiveConnectConfig:
    """The session config. `resume_handle` restores a prior conversation."""
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
            )
        ),
        system_instruction=system_instruction,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=VAD_CONFIG
        ),
        context_window_compression=COMPRESSION_CONFIG,
        # Lowest latency. A phone caller forgives a simpler answer far more
        # readily than a pause.
        #
        # Nested under thinking_config, not a top-level thinking_level — the
        # latter is rejected here and silently ignored by the JS SDK, so the
        # model runs at its default while the code claims otherwise.
        thinking_config=types.ThinkingConfig(
            thinking_level=types.ThinkingLevel.MINIMAL
        ),
        # Empty config asks the server to start issuing handles; a handle means
        # "restore that conversation".
        session_resumption=types.SessionResumptionConfig(handle=resume_handle),
    )


# ── Session ─────────────────────────────────────────────────────────────────

Role = Literal["caller", "agent"]


@dataclass
class Turn:
    role: Role
    text: str


@dataclass
class LiveSession:
    """
    One conversation, which may outlive several WebSocket connections.

    Audio in via `send_audio`, audio out via the `on_audio` callback. Nothing
    here touches a microphone — that is the caller's job, whether it is PyAudio
    on a laptop or an RTP stream off a SIP trunk.
    """

    system_instruction: str
    voice: str = DEFAULT_VOICE
    on_audio: Callable[[bytes], Awaitable[None]] | None = None
    on_turn: Callable[[Turn], None] | None = None
    on_interrupt: Callable[[], None] | None = None

    transcript: list[Turn] = field(default_factory=list)
    total_tokens: int = 0

    _client: genai.Client | None = None
    _session: object | None = None
    _resume_handle: str | None = None
    _pending_role: Role | None = None
    _outbox: asyncio.Queue[bytes] | None = None
    _stopping: bool = False
    _reconnects: int = 0
    # Set when a reconnect is needed; the run loop reacts rather than the
    # message handler reconnecting underneath itself.
    _reconnect: asyncio.Event | None = None

    def __post_init__(self) -> None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise SystemExit(
                "GEMINI_API_KEY is not set.\n"
                "  export GEMINI_API_KEY=...   (get one at https://aistudio.google.com/apikey)"
            )
        self._client = genai.Client(
            api_key=api_key, http_options={"api_version": API_VERSION}
        )
        self._outbox = asyncio.Queue(maxsize=32)
        self._reconnect = asyncio.Event()

    async def send_audio(self, pcm: bytes) -> None:
        """Queue 16 kHz mono PCM16 for the model."""
        assert self._outbox is not None
        try:
            self._outbox.put_nowait(pcm)
        except asyncio.QueueFull:
            # Better to drop the oldest frame than to build a backlog: audio
            # delivered late is worse than audio not delivered, because the
            # model answers a question the caller has moved on from.
            with contextlib.suppress(asyncio.QueueEmpty):
                self._outbox.get_nowait()
            self._outbox.put_nowait(pcm)

    async def send_text(self, text: str) -> None:
        if self._session is None:
            return
        await self._session.send_realtime_input(text=text)

    async def run(self) -> None:
        """Holds the conversation open across reconnects until `stop()`."""
        assert self._client is not None and self._reconnect is not None

        while not self._stopping:
            resuming = self._resume_handle is not None
            config = build_config(
                self.system_instruction, self.voice, self._resume_handle
            )

            try:
                async with self._client.aio.live.connect(
                    model=MODEL, config=config
                ) as session:
                    self._session = session
                    self._reconnect.clear()
                    print(
                        f"[live] {'resumed' if resuming else 'connected'}",
                        file=sys.stderr,
                    )

                    # The agent speaks first. Without this the model waits to be
                    # spoken to, and a caller who picks up to silence hangs up.
                    # A resumed session gets a different marker so it continues
                    # instead of greeting the same person twice.
                    await session.send_realtime_input(
                        text=RECONNECTED_MARKER if resuming else CONNECTED_MARKER
                    )

                    async with asyncio.TaskGroup() as tg:
                        pump = tg.create_task(self._pump_audio())
                        receive = tg.create_task(self._receive())
                        waiter = tg.create_task(self._reconnect.wait())

                        # Whichever finishes first ends this connection; the
                        # outer loop decides whether to open another.
                        done, pending = await asyncio.wait(
                            {pump, receive, waiter},
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        for task in pending:
                            task.cancel()

            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - reconnect on anything transient
                if self._stopping:
                    break
                print(f"[live] connection error: {exc}", file=sys.stderr)
                self._reconnect.set()
            finally:
                self._session = None

            if self._stopping:
                break

            if self._resume_handle is None:
                # Nothing to resume into. Reconnecting would silently start a
                # brand-new conversation, so stop instead of pretending.
                print(
                    "[live] connection ended before a resume handle was issued; stopping",
                    file=sys.stderr,
                )
                break

            self._reconnects += 1
            if self._reconnects > 5:
                print("[live] too many reconnects; stopping", file=sys.stderr)
                break
            await asyncio.sleep(0.25 * self._reconnects)

    async def _pump_audio(self) -> None:
        assert self._outbox is not None
        while True:
            pcm = await self._outbox.get()
            if self._session is None:
                continue
            await self._session.send_realtime_input(
                audio=types.Blob(data=pcm, mime_type=f"audio/pcm;rate={SEND_SAMPLE_RATE}")
            )

    async def _receive(self) -> None:
        assert self._session is not None
        # receive() ends at every turn_complete; re-enter it for the next turn
        # or a single-sentence answer would look like a dropped socket.
        while True:
            async for message in self._session.receive():
                await self._handle(message)

    async def _handle(self, message: object) -> None:
        # Latest handle wins; older ones resume to a staler point.
        update = getattr(message, "session_resumption_update", None)
        if update is not None and update.resumable and update.new_handle:
            self._resume_handle = update.new_handle

        # 60 seconds of warning before the server closes the socket.
        # Reconnecting now, while this one still works, is the difference
        # between a seamless swap and a dropped call.
        if getattr(message, "go_away", None) is not None:
            left = message.go_away.time_left
            print(f"[live] going away in {left}; reconnecting", file=sys.stderr)
            assert self._reconnect is not None
            self._reconnect.set()
            return

        usage = getattr(message, "usage_metadata", None)
        if usage is not None and usage.total_token_count:
            self.total_tokens = usage.total_token_count

        content = getattr(message, "server_content", None)
        if content is None:
            return

        if content.interrupted:
            # Caller barged in. Whoever owns the speaker has to drop the
            # audio it already holds, or the agent talks over them.
            self._pending_role = None
            if self.on_interrupt:
                self.on_interrupt()
            return

        if getattr(content, "input_transcription", None) and content.input_transcription.text:
            self._append("caller", content.input_transcription.text)
        if getattr(content, "output_transcription", None) and content.output_transcription.text:
            self._append("agent", content.output_transcription.text)

        # One event can carry several parts, so read them all.
        if content.model_turn is not None:
            for part in content.model_turn.parts:
                inline = part.inline_data
                if inline and inline.mime_type.startswith("audio/pcm"):
                    if self.on_audio:
                        await self.on_audio(inline.data)

        if content.turn_complete:
            self._pending_role = None

    def _append(self, role: Role, text: str) -> None:
        """Coalesce streamed fragments into whole turns."""
        if self._pending_role == role and self.transcript and self.transcript[-1].role == role:
            self.transcript[-1].text += text
            turn = self.transcript[-1]
        else:
            turn = Turn(role=role, text=text)
            self.transcript.append(turn)
            self._pending_role = role
        if self.on_turn:
            self.on_turn(turn)

    def stop(self) -> None:
        self._stopping = True
        assert self._reconnect is not None
        self._reconnect.set()


# ── Interactive microphone runner ───────────────────────────────────────────
# Convenience for testing a persona from a laptop. The SIP bridge will replace
# this layer, not LiveSession.


async def run_microphone(agent_key: str, voice: str) -> None:
    try:
        import pyaudio  # noqa: PLC0415 - optional, only the CLI path needs it
    except ImportError:
        raise SystemExit("pip install pyaudio  # needed only for the microphone runner")

    prompt = AGENT_PROMPTS.get(agent_key)
    if prompt is None:
        raise SystemExit(
            f"Unknown agent '{agent_key}'. Available: {', '.join(sorted(AGENT_PROMPTS))}"
        )

    pya = pyaudio.PyAudio()
    speaker = await asyncio.to_thread(
        pya.open,
        format=pyaudio.paInt16,
        channels=1,
        rate=RECEIVE_SAMPLE_RATE,
        output=True,
    )
    playback: asyncio.Queue[bytes] = asyncio.Queue()

    async def on_audio(pcm: bytes) -> None:
        await playback.put(pcm)

    def on_interrupt() -> None:
        # Drop everything not yet played. Without this the agent keeps talking
        # for a second after being interrupted, which is the single most
        # unnatural thing a voice bot does.
        while not playback.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                playback.get_nowait()
        print("\n[interrupted]", flush=True)

    def on_turn(turn: Turn) -> None:
        prefix = "\nYou: " if turn.role == "caller" else "\nRiya: "
        print(f"{prefix}{turn.text}", end="", flush=True)

    session = LiveSession(
        system_instruction=prompt.system_instruction
        + language_directive(prompt.languages),
        voice=voice,
        on_audio=on_audio,
        on_turn=on_turn,
        on_interrupt=on_interrupt,
    )

    async def play() -> None:
        while True:
            pcm = await playback.get()
            await asyncio.to_thread(speaker.write, pcm)

    async def listen() -> None:
        mic_info = pya.get_default_input_device_info()
        stream = await asyncio.to_thread(
            pya.open,
            format=pyaudio.paInt16,
            channels=1,
            rate=SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=CHUNK_SIZE,
        )
        print(
            f"Mic: {mic_info.get('name')} — speak freely. "
            "Use headphones, or the agent hears itself and interrupts its own turn.",
            file=sys.stderr,
        )
        while True:
            data = await asyncio.to_thread(
                stream.read, CHUNK_SIZE, exception_on_overflow=False
            )
            await session.send_audio(data)

    print(f"Agent: {prompt.name}  ·  voice: {voice}  ·  Ctrl-C to end", file=sys.stderr)

    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(session.run())
            tg.create_task(listen())
            tg.create_task(play())
    except* KeyboardInterrupt:
        session.stop()
    except* Exception as group:
        traceback.print_exception(group)
    finally:
        print(
            f"\n[live] {session.total_tokens} tokens, {len(session.transcript)} turns",
            file=sys.stderr,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Swara live voice agent")
    parser.add_argument(
        "--agent",
        default="grievance",
        help=f"one of: {', '.join(sorted(AGENT_PROMPTS))}",
    )
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    args = parser.parse_args()

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run_microphone(args.agent, args.voice))


if __name__ == "__main__":
    main()
