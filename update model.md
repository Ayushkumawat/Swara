## 1. What's new in 3.8 Live vs. the 3.1 Flash Live you're using now

| Change | Why it matters for a calling agent |
|---|---|
| **Asynchronous function calling is now default** (`behavior: NON_BLOCKING`) | On 3.1, a tool call (e.g., "look up this order") blocks the conversation — the agent goes silent until it returns. On 3.8, the agent can keep talking naturally while the lookup runs in the background. This is a direct, meaningful upgrade for your order-status/CRM-lookup use cases. |
| **Function scheduling** (`SILENT`, `WHEN_IDLE`, `INTERRUPTED`) | Fine control over *when* a background tool's result gets folded into the conversation — e.g., wait until the caller stops talking before mentioning what you found. |
| **Context window: 128K tokens** (up from 32K on non-native-audio Live models) | Longer calls retain more memory without needing aggressive session compression. |
| **`send_client_content` throughout the entire session** with explicit `user`/`model` roles | Lets you inject or correct context mid-call more flexibly than 3.1 allowed. |
| **Proactive audio is permanently on** (can't be disabled — `proactive_audio: false` now errors) | The model can choose not to respond to audio that isn't actually directed at it (background noise, a side conversation). Useful, but you no longer have the option to turn it off if you relied on that. |
| **Search grounding supported** | The agent can pull live web results mid-call — relevant for FAQ/pricing/current-info questions, not just your own knowledge base. |
| **`thinking_level` removed** (interleaved reasoning instead) | 3.8 Live reasons continuously rather than via discrete thinking-budget levels. 

**Migration is mostly a one-line change**: swap `gemini-3.1-flash-live-preview` → `gemini-3.8-live` in your model string, and remove any `thinking_level`/`thinking_config` and `enable_affective_dialog` settings from your session setup (see §4).

---

## 2. Voices — what you can actually control

### Prebuilt voices (confirmed working in Live API)
Set via `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`. 30 named voices, each with a built-in character:

`Zephyr` (Bright) · `Puck` (Upbeat) · `Charon` (Informative) · `Kore` (Firm) · `Fenrir` (Excitable) · `Leda` (Youthful) · `Orus` (Firm) · `Aoede` (Breezy) · `Callirrhoe` (Easy-going) · `Autonoe` (Bright) · `Enceladus` (Breathy) · `Iapetus` (Clear) · `Umbriel` (Easy-going) · `Algieba` (Smooth) · `Despina` (Smooth) · `Erinome` (Clear) · `Algenib` (Gravelly) · `Rasalgethi` (Informative) · `Laomedeia` (Upbeat) · `Achernar` (Soft) · `Alnilam` (Firm) · `Schedar` (Even) · `Gacrux` (Mature) · `Pulcherrima` (Forward) · `Achird` (Friendly) · `Zubenelgenubi` (Casual) · `Vindemiatrix` (Gentle) · `Sadachbia` (Lively) · `Sadaltager` (Knowledgeable) · `Sulafat` (Warm)

```python
config = {
    "response_modalities": ["AUDIO"],
    "speech_config": {
        "voice_config": {"prebuilt_voice_config": {"voice_name": "Kore"}}
    },
}
```
additional option beyond the 30 prebuilt voices:
- **Extended Voice Library**: hundreds more voices, filterable by language, accent, gender, pitch, persona (`client.voices.list()`)

### Speed control — no dedicated parameter in Live API
There is no `speaking_rate` or similar numeric parameter documented for the Live API. For Live API, pace control is **emergent from your system instructions** ("speak at a measured, unhurried pace") rather than a guaranteed, enforced parameter. Test how reliably this holds under real conversation before depending on it.

## 3. Multilingual mid-conversation switching — this one is solid

This is explicitly documented and matches exactly what you asked for:

> "Native audio output models can switch between languages naturally during conversation. You can also restrict the languages it speaks in by specifying it in the system instructions."

No language-code parameter to set — the model detects and switches automatically. To **restrict** it to a specific set (e.g., only your 9 target languages), use a system instruction:

```python
config = {
    "response_modalities": ["AUDIO"],
    "system_instruction": {
        "parts": [{
            "text": "You are a customer support agent. Respond in whichever of these "
                    "languages the caller is speaking: Hindi, Tamil, Telugu, Kannada, "
                    "Bengali, Marathi, Gujarati, Punjabi, Hinglish, or English. "
                    "Switch languages immediately and naturally if the caller switches, "
                    "even mid-conversation. Never ask the caller to pick a language."
        }]
    },
    "speech_config": {
        "voice_config": {"prebuilt_voice_config": {"voice_name": "Kore"}}
    },
}
```

All 99 supported languages (full table in Google's docs) include every language you listed as a target: Hindi (`hi`), Tamil (`ta`), Telugu (`te`), Kannada (`kn`), Bengali (`bn`), Marathi (`mr`), Gujarati (`gu`), Punjabi (`pa`), plus English (`en`). "Hinglish" isn't a separate BCP-47 code — it emerges naturally from the model's code-switching behavior when prompted conversationally rather than being a selectable language.

---

## 4. ⚠️ Affective dialogue — a real contradiction in Google's own docs

This directly matters for your "tweak emotion" ask, so it's worth flagging plainly rather than picking one source and moving on:

- The **Live API capabilities page** documents `enable_affective_dialog` (lets the model adapt its response tone to match the caller's detected emotion) with the note: *"This feature is not supported in Gemini 3.1 Flash Live"* — which, by omission, implies it **is** supported in 3.8 Live.
- The **Gemini 3.8 Live model migration page** explicitly says: *"Affective dialogue is removed from the API. Remove any `enable_affective_dialog` configurations from your code"* when migrating to 3.8 Live.

These two official pages disagree. My read: the migration page is more specific to 3.8 Live itself and is more likely current, while the capabilities page's affective-dialogue section may be stale or written before 3.8 shipped. **Don't build a feature around this without testing it directly** — set `enable_affective_dialog: True` against your actual API key and see whether the session setup succeeds or errors. If removed, your emotion-adaptation needs would have to come from prompting ("respond with empathy and a calmer tone if the caller sounds frustrated") rather than this flag.

```python
# Test this directly — docs conflict on whether it works for gemini-3.8-live
client = genai.Client(http_options={"api_version": "v1beta"})
config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    enable_affective_dialog=True  # may error on 3.8 Live — verify
)
```

---

## 5. Voice Activity Detection (VAD) and interruption handling

Full control over how the model detects turn-taking — relevant to your "realistic conversation, natural barge-in" goals:

```python
config = {
    "response_modalities": ["AUDIO"],
    "realtime_input_config": {
        "automatic_activity_detection": {
            "disabled": False,
            "start_of_speech_sensitivity": types.StartSensitivity.START_SENSITIVITY_LOW,
            "end_of_speech_sensitivity": types.EndSensitivity.END_SENSITIVITY_LOW,
            "prefix_padding_ms": 20,       # audio included before speech is detected — avoids clipping first syllable
            "silence_duration_ms": 100,    # how long to wait through silence before ending the turn
        }
    }
}
```

**Tuning guidance straight from Google's docs**: keep `silence_duration_ms` in the 500–800ms range. Below 200ms, natural pauses (breathing, thinking) get mis-detected as end-of-turn and fragment the caller's sentence, hurting both transcription and response quality. Above 2000ms, the caller perceives real lag. The server's internal default is ~800ms.

For lower perceived latency, Google documents a **Hybrid VAD** pattern: keep server-side automatic VAD for robust speech-start detection, but run your own client-side VAD to detect speech-*end* and send an early `audio_stream_end` signal — this bypasses the server's default silence-wait and finalizes the turn immediately once your client is confident the caller has stopped talking.

When an interruption happens, the server cancels generation, discards any pending function calls, and sends an `interrupted` flag — your client should stop audio playback and clear its queue immediately:

```python
async for response in session.receive():
    if response.server_content.interrupted is True:
        # stop playback, clear your audio queue now
        pass
```

---

## 6. Asynchronous function calling (the real upgrade from 3.1)

This is the single most impactful change for your use case. On 3.1 Flash Live, calling a tool (order lookup, CRM query) blocked the conversation. On 3.8:

```python
# Tool declaration with async behavior (default in 3.8, but shown explicit here)
tools = [{
    "function_declarations": [{
        "name": "lookup_order_status",
        "description": "Look up the live delivery status of a customer's order",
        "parameters": {...},
        "behavior": "NON_BLOCKING",  # agent keeps talking while this runs
    }]
}]

config = {
    "response_modalities": ["AUDIO"],
    "tools": tools,
}
```

**Function scheduling** controls exactly when the result gets woven back in:
- `SILENT` — inject the result without the agent necessarily commenting immediately
- `WHEN_IDLE` — wait until the caller stops talking before mentioning it
- `INTERRUPTED` — allowed to interrupt the caller with the result if urgent

This is exactly the mechanism for your "fetch live order status mid-call without going silent" feature from the Agents & Flows screen we designed earlier — build your data-pull nodes around `NON_BLOCKING` + `WHEN_IDLE` as the default pattern.

---

## 7. Audio transcription (built-in — useful for your Analytics/Complaints screens)

You don't need a separate STT call for transcripts — enable both input and output transcription directly in the Live session:

```python
config = {
    "response_modalities": ["AUDIO"],
    "input_audio_transcription": {},   # transcribes the caller
    "output_audio_transcription": {},  # transcribes the agent
}
```

```python
async for response in session.receive():
    if response.server_content.input_transcription:
        print("Caller:", response.server_content.input_transcription.text)
    if response.server_content.output_transcription:
        print("Agent:", response.server_content.output_transcription.text)
```

This transcript feed is exactly what your Complaints audit trail and Analytics call-scoring features need — wire it directly into your call-logging pipeline rather than running a separate transcription pass after the call.

---

## 8. Audio format — the telephony integration detail that will bite you if missed

- **Input to Gemini**: raw 16-bit PCM, 16kHz, little-endian (`audio/pcm;rate=16000`) — this matches what Plivo's Audio Streaming sends you, so no conversion needed on the inbound leg.
- **Output from Gemini**: always 24kHz, 16-bit PCM.
- **Telephony networks (PSTN via Plivo) typically expect 8kHz mu-law/A-law (G.711)** for the leg back to the caller.

**You need a resampling/transcoding step** between Gemini's 24kHz PCM output and whatever Plivo's Audio Streaming expects back from you. Confirm Plivo's exact expected return format (check their Audio Streaming docs for the outbound leg) — this is a common integration gap that causes garbled or silent audio if missed, not a Gemini-side problem.

---

## 9. Session duration limits — plan around this for long calls

- **Audio-only sessions**: capped at **15 minutes**

For anything longer (a genuinely long support call), you need **session management techniques** — context compression or session resumption — documented at the Live API's Session Management guide. Build this into your architecture now rather than discovering it in production when a 20-minute grievance call drops mid-sentence.

---

## 10. Recommended next steps to explore "full potential"

1. **Test the affective-dialogue flag directly** (§4) — don't build around either doc page without confirming.
2. **Test whether a Voice Design / Voice Replication `voice_...` ID works in `prebuilt_voice_config`** (§2) — if it does, you may be able to use a cloned/custom voice in real-time calls, which would be a strong differentiator; if not, you're working with the 30 prebuilt voices for live calls.
3. **Switch to `NON_BLOCKING` function calling** for every data-pull node in your Agents & Flows builder — this is a genuine capability upgrade over what 3.1 gave you.
4. **Build the 8kHz↔24kHz resampling layer explicitly** — don't assume audio "just works" between Plivo and Gemini.
5. **Decide your VAD tuning** (§5) — this is a real latency-vs-accuracy dial worth testing with actual Hindi/Tamil/Hinglish callers, since natural pause patterns differ across languages and code-switching speech.