"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { SWARA_GREETING } from "@/lib/agents/swara";
import type { AgentPlan } from "@/lib/api/schemas";
import type { SwaraContext } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "model"; text: string; receipts?: string[] };

/**
 * The thread lives outside the component so closing the drawer and opening
 * it again on another screen continues the same conversation. "New chat"
 * resets it.
 */
const useThread = create<{ messages: Turn[]; set: (m: Turn[]) => void; reset: () => void }>((set) => ({
  messages: [{ role: "model", text: SWARA_GREETING }],
  set: (messages) => set({ messages }),
  reset: () => set({ messages: [{ role: "model", text: SWARA_GREETING }] }),
}));

export function resetSwaraThread() {
  useThread.getState().reset();
}

/** What a tool did, in the owner's words, for the receipt under a reply. */
const RECEIPT: Record<string, (r: Record<string, unknown>) => string | null> = {
  save_playbook: () => "Business details saved",
  add_department: (r) => (typeof r.department === "string" ? `Department: ${r.department}` : "Department added"),
  add_transfer_target: (r) => (typeof r.desk === "string" ? `Transfer desk: ${r.desk}` : "Transfer desk added"),
  add_appointment_type: (r) => (typeof r.appointment_type === "string" ? `Bookable: ${r.appointment_type}` : "Appointment type added"),
  add_knowledge: (r) => (typeof r.document === "string" ? `Knowledge: ${r.document}` : "Knowledge saved"),
  propose_agents: () => "Plan ready for review",
  update_agent: (r) => (r.changed ? `Updated ${typeof r.agent === "string" ? r.agent : "agent"}` : null),
};

/**
 * Text chat with Swara. She writes the workspace and edits agents through
 * tools on the server; a failed turn leaves the thread and everything saved
 * exactly where they were.
 */
export function SwaraChat({
  onSaved,
  onPlan,
  seed,
  context,
  suggestions = [],
  className,
}: {
  onSaved?: (toolName: string) => void;
  onPlan?: (plan: AgentPlan) => void;
  /** Prefill for the input, consumed once. */
  seed?: string;
  context?: SwaraContext;
  /** Chips shown under the thread while it is still just the greeting. */
  suggestions?: string[];
  className?: string;
}) {
  const messages = useThread((s) => s.messages);
  const setMessages = useThread((s) => s.set);
  const [draft, setDraft] = useState(seed ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // A new seed while mounted (the drawer is open and another screen asks
  // Swara something) replaces the draft; adjusted during render, not synced.
  const [lastSeed, setLastSeed] = useState(seed);
  if (seed !== lastSeed) {
    setLastSeed(seed);
    if (seed) setDraft(seed);
  }
  useEffect(() => {
    if (seed) inputRef.current?.focus();
  }, [seed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const send = async (history: Turn[]) => {
    setBusy(true);
    setFailed(false);
    try {
      if (IS_MOCK) {
        setMessages([...history, { role: "model", text: "Demo mode — connect the API to let Swara write the workspace." }]);
        return;
      }
      const res = await mutations.swaraChat(
        history.map(({ role, text }) => ({ role, text })),
        context,
      );
      const receipts = res.tools
        .filter((t) => typeof t.result.error !== "string")
        .map((t) => RECEIPT[t.name]?.(t.result) ?? null)
        .filter((r): r is string => Boolean(r));
      setMessages([...history, { role: "model", text: res.reply, receipts }]);
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

  const submit = (text = draft) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const history = [...messages, { role: "user" as const, text: clean }];
    setMessages(history);
    setDraft("");
    void send(history);
  };

  const fresh = messages.length === 1;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <div key={`${i}-${m.role}`} className={cn(m.role === "user" && "flex justify-end")}>
            <p
              className={cn(
                "whitespace-pre-wrap rounded-[12px] px-3 py-2 text-[12.5px] leading-relaxed",
                m.role === "model" ? "bg-white/[0.04] text-t1" : "max-w-[88%] bg-violet/15 text-t1",
              )}
            >
              {m.text}
            </p>
            {m.receipts?.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5 px-1">
                {m.receipts.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded-full border border-cyan/25 bg-cyan/[0.08] px-2 py-0.5 text-[10.5px] text-cyan">
                    <Check className="size-3" /> {r}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 px-1 text-[11.5px] text-t3">
            <Loader2 className="size-3.5 animate-spin" /> Swara is working on it…
          </p>
        ) : null}
        {fresh && suggestions.length && !busy ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="rounded-full border border-hairline bg-white/[0.03] px-3 py-1 text-left text-[11.5px] text-t2 transition-colors hover:border-cyan/30 hover:text-t1"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      {failed ? (
        <Button size="sm" variant="subtle" className="my-2 self-start" disabled={busy} onClick={() => void send(messages)}>
          Retry
        </Button>
      ) : null}
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
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
          placeholder={context?.agentName ? `Change ${context.agentName}, or describe something new…` : "Describe your business, or what to change…"}
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
