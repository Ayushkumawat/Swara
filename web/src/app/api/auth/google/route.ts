import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_COOKIE,
  authorizationUrl,
  googleConfigured,
  newOAuthState,
  oauthCookieOptions,
} from "@/lib/server/google-oauth";

export const runtime = "nodejs";

/**
 * GET /api/auth/google?mode=login|signup&next=/overview
 *
 * Step one of the Google flow: remember what the person was doing (state,
 * PKCE verifier, login vs signup, where to land) in a short-lived cookie and
 * hand off to Google. Nothing is written to the database yet.
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "signup" ? "signup" : "login";
  const rawNext = req.nextUrl.searchParams.get("next") ?? "";
  // Only same-origin paths — an open redirect through the login page is the
  // classic OAuth footgun.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/overview";

  if (!googleConfigured()) {
    const back = new URL(mode === "signup" ? "/signup" : "/login", req.nextUrl.origin);
    back.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(back);
  }

  const state = newOAuthState(mode, next);
  const res = NextResponse.redirect(authorizationUrl(req, state));
  res.cookies.set(OAUTH_COOKIE, JSON.stringify(state), oauthCookieOptions);
  return res;
}
