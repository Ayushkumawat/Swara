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
