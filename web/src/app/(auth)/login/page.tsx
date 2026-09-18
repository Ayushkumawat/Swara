"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/controls";
import { GoogleButton, authErrorMessage } from "@/components/auth/google-button";
import { IS_MOCK, mutations } from "@/lib/api/client";

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary during prerender.
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Google's callback redirects here with ?error=… on failure.
  const [error, setError] = useState<string | null>(() => authErrorMessage(params.get("error")));

  // Where the 401 redirect came from, so login lands back on the page the
  // person was actually trying to reach. A department user deep-links to
  // /queue, gets bounced here, signs in, and is on their queue.
  const next = params.get("next") ?? "/overview";

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (IS_MOCK) {
      // Demo mode has no backend to check against.
      setTimeout(() => router.push(next), 600);
      return;
    }
    try {
      await mutations.login(email, password);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? parseError(e.message) : "Could not sign in");
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[400px]"
    >
      <Card interactive={false} className="p-7">
        <h1 className="font-[family-name:var(--font-display)] text-[21px] font-semibold text-t1">
          Sign in
        </h1>
        <p className="mt-1.5 text-[13px] text-t2">Welcome back.</p>

        <div className="mt-6 space-y-4">
          <Field label="Email">
            <TextInput
              value={email}
              onChange={setEmail}
              type="email"
              placeholder="rohan@yourcompany.in"
            />
          </Field>
          <Field label="Password">
            <TextInput
              value={password}
              onChange={setPassword}
              type="password"
              placeholder="••••••••"
              onSubmit={() => void submit()}
            />
          </Field>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-[12px] text-coral">
            {error}
          </p>
        ) : null}

        {!IS_MOCK ? (
          <p className="mt-3 text-[11px] text-t3">
            Demo workspace: <span className="font-medium text-t2">demo@swara.in</span> /{" "}
            <span className="font-medium text-t2">swara-demo</span> — or a department desk like{" "}
            <span className="font-medium text-t2">cleaning@swara.in</span>
          </p>
        ) : null}

        <Button variant="primary" full className="mt-4" disabled={busy} onClick={submit}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-[11px] text-t3">or</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        {IS_MOCK ? (
          <Button variant="ghost" full onClick={() => router.push(next)}>
            Continue with Google
          </Button>
        ) : (
          <GoogleButton mode="login" next={next} />
        )}

        <p className="mt-5 text-center text-[12px] text-t3">
          New here?{" "}
          <Link href="/signup" className="font-medium text-cyan hover:underline">
            Create a workspace
          </Link>
        </p>
      </Card>
    </motion.div>
  );
}

/** API errors arrive as JSON strings; show the message, not the envelope. */
function parseError(raw: string) {
  try {
    return (JSON.parse(raw) as { error?: string }).error ?? raw;
  } catch {
    return raw;
  }
}
