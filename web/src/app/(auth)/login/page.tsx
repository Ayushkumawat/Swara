"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/controls";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    setTimeout(() => router.push("/overview"), 600);
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
            <TextInput value={password} onChange={setPassword} type="password" placeholder="••••••••" />
          </Field>
        </div>

        <Button variant="primary" full className="mt-6" disabled={busy} onClick={submit}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-[11px] text-t3">or</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <Button variant="ghost" full onClick={() => router.push("/overview")}>
          Continue with Google
        </Button>

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
