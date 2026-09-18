/**
 * Spoken on every real call, browser test included. One string so the prompt,
 * the consent artefact, and the Live board never disagree about what was said.
 */
export const RECORDING_DISCLOSURE =
  "This call is being recorded for quality and training purposes.";

/** Appended to every calling agent's system instruction (not Swara setup). */
export function recordingDirective() {
  return [
    "RECORDING DISCLOSURE",
    `On [CALL_CONNECTED] only: after you say your name in the opening line, in the same breath, tell the caller: "${RECORDING_DISCLOSURE}"`,
    "Then ask how you can help. Do this in the language of the greeting.",
    "Do not skip it. Do not wait for them to agree. Do not mention recording again unless they ask.",
    "On [CALL_RECONNECTED] do not repeat the disclosure.",
  ].join(" ");
}
