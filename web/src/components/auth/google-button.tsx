"use client";

import { useState } from "react";
import { ExternalButtonLink } from "@/components/ui/button";

/**
 * "Continue with Google". A plain <a>, not a fetch or router push: the OAuth
 * dance is a chain of redirects through a route handler and Google, and the
 * browser has to follow all of them.
 */
export function GoogleButton({
  mode,
  next,
  label,
}: {
  mode: "login" | "signup";
  next?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const href = `/api/auth/google?mode=${mode}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <ExternalButtonLink variant="ghost" full href={href} onClick={() => setBusy(true)}>
      <GoogleMark />
      {busy ? "Opening Google…" : label ?? "Continue with Google"}
    </ExternalButtonLink>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
      <path fill="#4285F4" d="M21.4 10.5H12v3.9h5.5c-.3 1.4-1.1 2.5-2.2 3.3l3.4 2.6c2-1.9 3.1-4.6 3.1-7.8 0-.7-.1-1.3-.4-2z" opacity=".95" />
      <path fill="#FBBC05" d="M6 12c0-.7.1-1.3.3-1.9L2.9 7.5C2.3 8.9 2 10.4 2 12s.3 3.1.9 4.5l3.4-2.6c-.2-.6-.3-1.2-.3-1.9z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.6c-.9.6-2 1-3.3 1-2.6 0-4.8-1.7-5.6-4.1l-3.4 2.6C4.6 19.8 8 22 12 22z" />
    </svg>
  );
}

/** Messages for the `?error=` codes the Google callback redirects with. */
export function authErrorMessage(code: string | null): string | null {
  switch (code) {
    case null:
      return null;
    case "google_not_configured":
      return "Google sign-in is not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or use your email and password.";
    case "google_denied":
      return "Google sign-in was cancelled.";
    case "google_state":
      return "That sign-in link expired. Please try again.";
    case "google_failed":
      return "Google did not complete the sign-in. Please try again.";
    case "unverified_email":
      return "Your Google account's email is not verified. Verify it with Google, then try again.";
    case "no_account":
      return "No workspace uses that Google account yet. Create one below — it takes a minute.";
    case "email_in_use_by_other_google":
      return "This email is already linked to a different Google account.";
    default:
      return "Could not sign you in. Please try again.";
  }
}
