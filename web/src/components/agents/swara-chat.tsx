"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { SWARA_GREETING } from "@/lib/agents/swara";
import type { AgentPlan } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "model"; text: string };

/**
 * Text chat with Swara. She writes the workspace through tools on the server.
 * A failed turn leaves the thread and any saved setup where they were.
 */
export function SwaraChat({
  onSaved,
  onPlan,
  className,
}: {
  onSaved?: (toolName: string) => void;
  onPlan?: (plan: AgentPlan) => void;
  className?: string;
}) {
  const [messages, setMessages] = useState<Turn[]>([{ role: "model", text: SWARA_GREETING }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = async (history: Turn[]) => {
    setBusy(true);
    setFailed(false);
    try {
      if (IS_MOCK) {
        setMessages([...history, { role: "model", text: "Demo mode — connect the API to let Swara write the workspace." }]);
        return;
      }
      const res = await mutations.swaraChat(history);
      setMessages([...history, { role: "model", text: res.reply }]);
      for (const tool of res.tools) {
        if (typeof tool.result.error !== "string") onSaved?.(tool.name);
      }
      if (res.plan) onPlan?.(res.plan);
    } catch (error) {
      setFailed(true);
      toast.error("Swara could not reply", {
        description: `${errorText(error)} Your workspace and this chat are unchanged — retry.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const history = [...messages, { role: "user" as const, text }];
    setMessages(history);
    setDraft("");
    void send(history);
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="mb-2 max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <p
            key={`${i}-${m.role}`}
            className={cn(
              "rounded-[12px] px-3 py-2 text-[12.5px] leading-relaxed",
              m.role === "model" ? "bg-white/[0.04] text-t1" : "ml-6 bg-violet/15 text-t1",
            )}
          >
            {m.text}
          </p>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 px-1 text-[11.5px] text-t3">
            <Loader2 className="size-3.5 animate-spin" /> Swara is writing that down…
          </p>
        ) : null}
      </div>
      {failed ? (
        <Button
          size="sm"
          variant="subtle"
          className="mb-2 self-start"
          disabled={busy}
          onClick={() => void send(messages)}
        >
          Retry
        </Button>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={busy}
          placeholder="Tell Swara about the business…"
          className="glass min-h-[44px] flex-1 resize-none rounded-[12px] px-3 py-2 text-[12.5px] text-t1 outline-none focus:border-cyan/40"
        />
        <Button type="submit" variant="primary" size="sm" disabled={busy || !draft.trim()} title="Send">
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}

function errorText(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* body was plain text */
  }
  return raw.replace(/^Error:\s*/, "") || "The model did not respond.";
}
