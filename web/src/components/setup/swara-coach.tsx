"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Send, Sparkles } from "lucide-react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { TextInput } from "@/components/ui/controls";
import { QueryBoundary, RowsSkeleton } from "@/components/ui/feedback";
import { Reveal } from "@/components/motion/primitives";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { qk, useSetupChat } from "@/lib/api/hooks";
import type { SetupChat, SetupPlan } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

const CallPanel = dynamic(() => import("@/components/live/call-panel").then((m) => m.CallPanel));

/**
 * Swara interviews the owner, stores the history, and can apply a real plan
 * (agents, knowledge, departments). Voice and text share the same chat row.
 */
export function SwaraCoach() {
  const query = useSetupChat();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [calling, setCalling] = useState(false);
  const [applying, setApplying] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [query.data?.messages.length]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    try {
      if (IS_MOCK) {
        toast.message("Connect the API to talk to Swara");
        return;
      }
      await mutations.setupChat(message);
      void qc.invalidateQueries({ queryKey: qk.setupChat });
      void qc.invalidateQueries({ queryKey: qk.agents });
    } catch {
      toast.error("Swara could not reply");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      if (IS_MOCK) return;
      const result = await mutations.applySetupPlan();
      toast.success(
        Array.isArray(result.agents)
          ? `Created ${(result.agents as string[]).join(", ")}`
          : "Workspace updated",
      );
      void qc.invalidateQueries({ queryKey: qk.setupChat });
      void qc.invalidateQueries({ queryKey: qk.agents });
      void qc.invalidateQueries({ queryKey: qk.playbook });
      void qc.invalidateQueries({ queryKey: qk.departments });
      void qc.invalidateQueries({ queryKey: qk.appointments });
      void qc.invalidateQueries({ queryKey: qk.transfers });
      void qc.invalidateQueries({ queryKey: qk.knowledge });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the plan");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Reveal>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card interactive={false}>
          <CardHead
            title="Talk to Swara"
            sub="She interviews you, remembers the thread, and builds specialised agents — not one mega-bot. Come back later; the history stays."
            action={
              <Button size="sm" variant="primary" onClick={() => setCalling(true)}>
                <Mic className="size-3.5" />
                Voice
              </Button>
            }
          />
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={6} />}>
            {(chat) => (
              <>
                <div ref={scroller} className="mb-3 max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                  {chat.messages.length === 0 ? (
                    <p className="rounded-[14px] bg-white/[0.04] px-3.5 py-3 text-[13px] leading-relaxed text-t2">
                      Namaste — I am Swara. Tell me what this number is for. A clinic, a shop, a
                      salon? I will ask the awkward questions (no order ID, two bookings, what to
                      never discuss) and then split the work across agents that can actually look
                      things up, book, transfer and hang up.
                    </p>
                  ) : (
                    chat.messages.map((m, i) => (
                      <div
                        key={`${m.at}-${i}`}
                        className={cn(
                          "max-w-[92%] rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed",
                          m.role === "assistant"
                            ? "bg-white/[0.05] text-t1"
                            : "ml-auto bg-violet/[0.18] text-t1",
                        )}
                      >
                        {m.text}
                      </div>
                    ))
                  )}
                  {busy ? (
                    <p className="text-[11.5px] text-t3">Swara is thinking…</p>
                  ) : null}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(draft);
                  }}
                >
                  <TextInput
                    value={draft}
                    onChange={setDraft}
                    placeholder="We are a dental clinic in Pune…"
                  />
                  <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>
                    <Send className="size-3.5" />
                  </Button>
                </form>
              </>
            )}
          </QueryBoundary>
        </Card>

        <div className="space-y-3">
          <QueryBoundary query={query} skeleton={<RowsSkeleton rows={4} />}>
            {(chat) => (
              <>
                <FactsCard facts={chat.facts} />
                <PlanCard chat={chat} applying={applying} onApply={() => void apply()} />
              </>
            )}
          </QueryBoundary>
        </div>
      </div>

      {calling ? (
        <CallPanel
          open={calling}
          onClose={() => {
            setCalling(false);
            void qc.invalidateQueries({ queryKey: qk.setupChat });
            void qc.invalidateQueries({ queryKey: qk.agents });
          }}
          agentId="ag_swara"
          agentName="Swara"
        />
      ) : null}
    </Reveal>
  );
}

function FactsCard({ facts }: { facts: SetupChat["facts"] }) {
  return (
    <Card interactive={false}>
      <CardHead title="Remembered" sub="Saved across sessions so you can continue later" />
      {facts.length === 0 ? (
        <p className="text-[12.5px] text-t3">Nothing stored yet. Answer a few questions.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {facts.map((f) => (
            <Pill key={f.topic} tone="violet">
              <span className="font-medium">{f.topic.replaceAll("_", " ")}</span>
            </Pill>
          ))}
        </div>
      )}
    </Card>
  );
}

function PlanCard({
  chat,
  applying,
  onApply,
}: {
  chat: SetupChat;
  applying: boolean;
  onApply: () => void;
}) {
  const plan = chat.plan;
  if (!plan || plan.agents.length === 0) {
    return (
      <Card interactive={false}>
        <CardHead title="Draft plan" sub="Appears once Swara understands the use case" />
        <p className="text-[12.5px] leading-relaxed text-t3">
          She will push to split lines (orders vs complaints, bookings vs the front desk) rather
          than one agent that invents answers.
        </p>
      </Card>
    );
  }

  return (
    <Card interactive={false}>
      <CardHead
        title="Draft plan"
        sub={chat.appliedAt ? "Applied — keep talking to add more" : "Review, then create for real"}
      />
      <p className="mb-3 text-[12.5px] leading-relaxed text-t2">{plan.summary}</p>
      <ul className="mb-3 space-y-2">
        {plan.receptionist ? (
          <li className="text-[12.5px] text-t1">
            Front desk <span className="text-t3">transfers to specialists</span>
          </li>
        ) : null}
        {plan.agents.map((a) => (
          <li key={a.name} className="text-[12.5px] text-t1">
            <span className="font-medium">{a.name}</span>
            <span className="text-t3"> · {a.intent.replaceAll("_", " ")}</span>
            {a.why ? <span className="mt-0.5 block text-[11.5px] text-t3">{a.why}</span> : null}
          </li>
        ))}
      </ul>
      <Button variant="primary" full disabled={applying} onClick={onApply}>
        <Sparkles className="size-3.5" />
        {chat.appliedAt ? "Apply updates" : "Create these agents"}
      </Button>
      <PlanExtras plan={plan} />
    </Card>
  );
}

function PlanExtras({ plan }: { plan: SetupPlan }) {
  const bits = [
    plan.departments.length ? `${plan.departments.length} departments` : null,
    plan.appointments.length ? `${plan.appointments.length} appointment types` : null,
    plan.transfers.length ? `${plan.transfers.length} human desks` : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return <p className="mt-2 text-[11px] text-t3">{bits.join(" · ")}</p>;
}
