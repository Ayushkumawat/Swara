import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { GoogleProfile } from "./auth";

/**
 * Google OAuth 2.0 / OpenID Connect, authorization-code flow with PKCE.
 *
 * Hand-rolled for the same reason sessions are: it is two redirects and one
 * token exchange. The identity we trust comes from Google's userinfo
 * endpoint called with the access token we just received — so there is no
 * JWT to verify locally and no key set to cache.
 *
 * Setup (Google Cloud Console → APIs & Services → Credentials → OAuth client,
 * type "Web application"):
 *   Authorised redirect URI:  <APP_URL>/api/auth/google/callback
 *   .env:                     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const OAUTH_COOKIE = "swara_oauth";
const OAUTH_TTL_SECONDS = 600;

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Where Google should send the browser back. Explicit env wins because the
 *  request origin is wrong behind most reverse proxies and tunnels. */
export function redirectUri(req: NextRequest) {
  const base = process.env.GOOGLE_REDIRECT_URI;
  if (base) return base;
  const origin = (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  return `${origin}/api/auth/google/callback`;
}

export type OAuthState = {
  state: string;
  verifier: string;
  mode: "login" | "signup";
  next: string;
};

export function newOAuthState(mode: "login" | "signup", next: string): OAuthState {
  return {
    state: randomBytes(16).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    mode,
    next,
  };
}

export const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: OAUTH_TTL_SECONDS,
};

export function authorizationUrl(req: NextRequest, s: OAuthState) {
  const challenge = createHash("sha256").update(s.verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state: s.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCodeForProfile(
  req: NextRequest,
  code: string,
  verifier: string,
): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${detail.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("Google returned no access token");

  const infoRes = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status})`);
  const info = (await infoRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    picture?: string;
    hd?: string;
  };
  if (!info.sub || !info.email) throw new Error("Google profile is missing an email");

  return {
    sub: info.sub,
    email: info.email,
    emailVerified: info.email_verified === true,
    name: info.name ?? info.given_name ?? info.email.split("@")[0],
    picture: info.picture,
    hostedDomain: info.hd,
  };
}
