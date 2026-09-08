"""
Moved to `agent/live_session.py`.

    export GEMINI_API_KEY=...
    python -m agent.live_session --agent grievance

This prototype had a working API key committed in the source. That key is in the
repository's git history, so removing the line does not un-leak it — it has to be
revoked at https://aistudio.google.com/apikey and replaced with one read from the
environment.

What the new module adds beyond this prototype:

  * key from the environment, never the source
  * context window compression, so calls are not capped at ~15 minutes
  * session resumption across the ~10-minute connection ceiling and network drops
  * `goAway` handling: reconnect on the 60-second warning, before the drop
  * VAD tuned so mid-sentence language switches don't trigger a false barge-in
  * transcript and token accounting, for QA scoring and per-minute billing
  * personas factored into `agent/prompts.py`, shared with the web console

The audio loop is otherwise the same design: PyAudio in at 16 kHz, PyAudio out
at 24 kHz, both driven from an asyncio TaskGroup.
"""

import sys

sys.exit(__doc__)
