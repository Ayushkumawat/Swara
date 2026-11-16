import "server-only";

/**
 * Text models for Swara's dashboard work and post-call analysis.
 *
 * Phone audio stays on the Live model (`lib/live/config.ts`). These calls are
 * ordinary generateContent requests: tool use, no audio, much cheaper.
 *
 * 2.5 Flash and 2.0 Flash no longer answer on this API. The newest Flash
 * ids (3.6 and later) 503 under load. 3.5 Flash has been generally available
 * since May 2026 and supports tool use; 3.5 Flash-Lite is the cheaper retry.
 * Set GEMINI_TEXT_MODEL to pin something else.
 */
const primary = process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.5-flash";
const backup = "gemini-3.5-flash-lite";

export const TEXT_MODELS = primary === backup ? [primary] : [primary, backup];

/**
 * A rejected key fails the same way on every model. Callers should stop
 * retrying and say so, instead of reporting that the model is merely down.
 */
export function geminiKeyError(error: unknown): string | null {
  const text = String(error);
  if (/reported as leaked/i.test(text)) {
    return "The Gemini API key was rejected because Google marked it as leaked. Put a new key in GEMINI_API_KEY (web/.env.local) and restart the server. Nothing was changed.";
  }
  if (/API_KEY_INVALID|API key not valid/i.test(text)) {
    return "The Gemini API key was rejected. Check GEMINI_API_KEY in web/.env.local and restart the server. Nothing was changed.";
  }
  return null;
}
