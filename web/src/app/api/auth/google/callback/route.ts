import { NextResponse, type NextRequest } from "next/server";
import { googleSignIn } from "@/lib/server/auth";
import { OAUTH_COOKIE, exchangeCodeForProfile, type OAuthState } from "@/lib/server/google-oauth";

export const runtime = "nodejs";

/**
 * GET /api/auth/google/callback?code=…&state=…
 *
 * Step two: check the state matches what we set out with, trade the code for
 * a profile, and let auth.ts decide which account (if any) that is. Every
 * failure lands back on the login/signup page with a readable `error` so the
 * person is never left staring at JSON.
 */
export async function GET(req: NextRequest) {
  const raw = req.cookies.get(OAUTH_COOKIE)?.value;
  let saved: OAuthState | null = null;
  try {
    saved = raw ? (JSON.parse(raw) as OAuthState) : null;
  } catch {
    saved = null;
  }
  const mode = saved?.mode ?? "login";
  const page = mode === "signup" ? "/signup" : "/login";

  const fail = (error: string) => {
    const url = new URL(page, req.nextUrl.origin);
    url.searchParams.set("error", error);
    const res = NextResponse.redirect(url);
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (req.nextUrl.searchParams.get("error")) return fail("google_denied");
  if (!saved || !code || !state || state !== saved.state) return fail("google_state");

  try {
    const profile = await exchangeCodeForProfile(req, code, saved.verifier);
    const result = await googleSignIn(profile, mode, req.headers.get("user-agent") ?? undefined);
    if ("error" in result) {
      if (result.error === "no_account") {
        const url = new URL("/signup", req.nextUrl.origin);
        url.searchParams.set("error", "no_account");
        url.searchParams.set("email", profile.email);
        const res = NextResponse.redirect(url);
        res.cookies.delete(OAUTH_COOKIE);
        return res;
      }
      return fail(result.error);
    }
    const dest = result.created ? "/onboarding" : saved.next || "/overview";
    const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (error) {
    console.error("[auth/google] callback failed:", error);
    return fail("google_failed");
  }
}
