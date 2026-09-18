"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Headphones, PhoneForwarded, Radio, UserRoundPlus } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveDot, Pill } from "@/components/ui/pill";
import { Field, Select, Tabs, TextInput } from "@/components/ui/controls";
import { CardSkeleton, EmptyState, QueryBoundary } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { CallDuration, SentimentMeter, Waveform } from "@/components/ui/live";
import { Reveal } from "@/components/motion/primitives";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { useLiveCalls, useTransfers } from "@/lib/api/hooks";
import { INTENT_LABEL, LANGUAGE_LABEL, type LiveCall } from "@/lib/api/schemas";
import { maskPhone } from "@/lib/utils";

type Filter = "all" | "frustrated" | "sales" | "support";
type Intervention = { call: LiveCall; action: "takeover" | "transfer" };

export default function LiveCallsPage() {
  const query = useLiveCalls();
  const [filter, setFilter] = useState<Filter>("all");
  const [listening, setListening] = useState<string | null>(null);
  const [intervention, setIntervention] = useState<Intervention | null>(null);

  const calls = useMemo(() => query.data ?? [], [query.data]);

  const counts = useMemo(
    () => ({
      all: calls.length,
      frustrated: calls.filter((c) => c.sentiment === "frustrated" || c.sentiment === "declining").length,
      sales: calls.filter((c) => c.intent === "sales_enquiry" || c.intent === "payment_reminder").length,
      support: calls.filter((c) =>
        ["order_status", "delivery_reschedule", "complaint", "booking"].includes(c.intent),
      ).length,
    }),
    [calls],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return calls;
    if (filter === "frustrated")
      return calls.filter((c) => c.sentiment === "frustrated" || c.sentiment === "declining");
    if (filter === "sales")
      return calls.filter((c) => c.intent === "sales_enquiry" || c.intent === "payment_reminder");
    return calls.filter((c) =>
      ["order_status", "delivery_reschedule", "complaint", "booking"].includes(c.intent),
    );
  }, [calls, filter]);

  const needsAttention = calls.filter((c) => c.sentiment === "frustrated");
  const listenWs = useRef<WebSocket | null>(null);

  const stopListen = () => {
    listenWs.current?.close();
    listenWs.current = null;
    setListening(null);
  };

  const toggleListen = async (call: LiveCall) => {
    if (listening === call.id) {
      stopListen();
      return;
    }
    stopListen();
    if (IS_MOCK || call.source === "browser") {
      setListening(call.id);
      toast("Listening in", { description: call.source === "browser" ? "Browser test — transcript only." : "Demo mode." });
      return;
    }
    try {
      const grant = await mutations.listenCall(call.id);
      if (grant.error || !grant.wsUrl) {
        toast.error(grant.error ?? "Could not open a listen stream");
        return;
      }
      const ws = new WebSocket(grant.wsUrl);
      listenWs.current = ws;
      const player = makePcmPlayer();
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { event?: string; sampleRate?: number; payload?: string };
          if (msg.event === "media" && msg.payload) player.push(msg.payload, msg.sampleRate ?? 16000);
        } catch { /* ignore */ }
      };
      ws.onopen = () => {
        setListening(call.id);
        toast("Listening in", { description: "Silent monitor — neither party hears you." });
      };
      ws.onerror = () => toast.error("Listen stream dropped");
      ws.onclose = () => {
        if (listenWs.current === ws) setListening(null);
        player.close();
      };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Listen failed");
    }
  };

  const intervene = async ({ call, action }: Intervention, phone: string) => {
    if (IS_MOCK) {
      toast.success(action === "takeover" ? "Bridging you onto the call…" : "Warm transfer started");
      return;
    }
    const res = await mutations.interveneCall(call.id, action, phone);
    if (res.error) toast.error(res.error);
    else toast.success(action === "takeover" ? "You are being bridged onto the call" : "Transfer started");
  };

  useEffect(() => () => stopListen(), []);

  return (
    <>
      <PageHead
        title="Live calls"
        sub={`${calls.length} active · real-time monitoring, listen-in, and transfer`}
        actions={
          <Button variant="ghost" onClick={() => query.refetch()}>
            <Radio className="size-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Frustrated calls get pulled out of the grid entirely. On a wall of
          equal cards the one that needs a human is the one you miss. */}
      <AnimatePresence>
        {needsAttention.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            className="mb-3.5 overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-coral/25 bg-coral/[0.09] px-4 py-3">
              <LiveDot tone="coral" />
              <span className="flex-1 text-[13px] text-t1">
                <span className="font-medium">{needsAttention.length} caller</span>
                {needsAttention.length > 1 ? "s are" : " is"} frustrated right now — sentiment
                dropped below 0.30 mid-call.
              </span>
              <Button size="sm" variant="danger" onClick={() => setFilter("frustrated")}>
                Show them
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Tabs
        className="mb-4"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "all", label: "All", count: counts.all },
          { value: "frustrated", label: "Needs attention", count: counts.frustrated },
          { value: "sales", label: "Sales", count: counts.sales },
          { value: "support", label: "Support", count: counts.support },
        ]}
      />

      <QueryBoundary
        query={query}
        skeleton={
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} height={230} />
            ))}
          </div>
        }
      >
        {() =>
          filtered.length === 0 ? (
            <Card interactive={false}>
              <EmptyState
                icon={<Radio strokeWidth={1.6} />}
                title="No calls in this view"
                body="Nothing matches this filter right now. Live calls appear here the moment they connect."
              />
            </Card>
          ) : (
            <motion.div layout className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((c) => (
                  <CallCard
                    key={c.id}
                    call={c}
                    listening={listening === c.id}
                    onListen={() => void toggleListen(c)}
                    onTakeover={() => setIntervention({ call: c, action: "takeover" })}
                    onTransfer={() => setIntervention({ call: c, action: "transfer" })}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )
        }
      </QueryBoundary>

      <InterveneModal
        intervention={intervention}
        onClose={() => setIntervention(null)}
        onConfirm={async (phone) => {
          if (intervention) await intervene(intervention, phone);
          setIntervention(null);
        }}
      />

      <Reveal>
      <Card interactive={false} className="mt-3.5">
        <CardHead
          title="What supervisors can do mid-call"
          sub="Listen is passive. Take over and transfer both bridge a human onto the live leg."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Headphones,
              title: "Listen",
              body: "Silent monitor. Neither party hears you; used for spot-checking quality.",
            },
            {
              icon: UserRoundPlus,
              title: "Take over",
              body: "You replace the agent on the call. The transcript so far is handed to you first.",
            },
            {
              icon: PhoneForwarded,
              title: "Transfer",
              body: "Warm transfer to a teammate with the conversation summary attached.",
            },
          ].map((x) => (
            <div key={x.title} className="glass rounded-[14px] p-3.5">
              <x.icon className="mb-2 size-4 text-cyan" strokeWidth={1.7} />
              <div className="text-[12.5px] font-medium text-t1">{x.title}</div>
              <p className="mt-1 text-[11.5px] leading-snug text-t3">{x.body}</p>
            </div>
          ))}
        </div>
      </Card>
      </Reveal>
    </>
  );
}

/**
 * Who takes the call. Configured transfer desks come first because they are
 * the numbers the agent itself is allowed to hand to; a free-typed number
 * covers the supervisor's own mobile.
 */
function InterveneModal({
  intervention,
  onClose,
  onConfirm,
}: {
  intervention: Intervention | null;
  onClose: () => void;
  onConfirm: (phone: string) => Promise<void>;
}) {
  const transfers = useTransfers();
  const [deskId, setDeskId] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const desks = transfers.data ?? [];
  const desk = desks.find((d) => d.id === deskId);
  const phone = deskId === "custom" || !deskId ? custom : desk?.phone ?? "";
  const valid = phone.replace(/[^\d]/g, "").length >= 10;
  const takeover = intervention?.action === "takeover";

  const confirm = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onConfirm(phone);
      setDeskId("");
      setCustom("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(intervention)}
      onClose={onClose}
      title={takeover ? "Take over this call" : "Transfer this call"}
      sub={
        intervention
          ? `${intervention.call.customerName ?? maskPhone(intervention.call.phone)} · ${intervention.call.agentName}. ${
              takeover
                ? "The agent leaves; the number you pick is bridged in with the transcript so far."
                : "Warm transfer — the agent introduces the caller, then drops off."
            }`
          : undefined
      }
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void confirm()}>
            {busy ? "Connecting…" : takeover ? "Bridge me in" : "Transfer"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={takeover ? "Who takes over" : "Transfer to"}>
          <Select
            value={deskId}
            onChange={setDeskId}
            placeholder="Pick a desk or type a number"
            options={[
              ...desks.map((d) => ({ value: d.id, label: `${d.name} · ${d.role}`, hint: `${d.phone}${d.hours ? ` · ${d.hours}` : ""}` })),
              { value: "custom", label: "Another number…", hint: "E.164 or 10-digit Indian mobile" },
            ]}
          />
        </Field>
        {deskId === "custom" || (!deskId && desks.length === 0) ? (
          <Field label="Number">
            <TextInput value={custom} onChange={setCustom} placeholder="+91 98765 43210" autoFocus onSubmit={() => void confirm()} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function CallCard({
  call,
  listening,
  onListen,
  onTakeover,
  onTransfer,
}: {
  call: LiveCall;
  listening: boolean;
  onListen: () => void;
  onTakeover: () => void;
  onTransfer: () => void;
}) {
  const hot = call.sentiment === "frustrated";
  const warm = call.sentiment === "declining";
  const tone = hot ? "coral" : warm ? "amber" : "cyan";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card
        interactive={false}
        className={hot ? "border-coral/30 bg-coral/[0.06]" : undefined}
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="font-[family-name:var(--font-mono)] text-xs text-t1">
            {maskPhone(call.phone)}
          </span>
          <div className="flex items-center gap-2">
            <Pill tone={call.direction === "inbound" ? "violet" : "grey"}>{call.direction}</Pill>
            <LiveDot tone={tone} />
          </div>
        </div>

        <div className="mb-1 text-[12.5px] text-t2">
          {INTENT_LABEL[call.intent]} · {LANGUAGE_LABEL[call.language]} ·{" "}
          <CallDuration startedAt={call.startedAt} className="text-t1" />
        </div>
        <div className="mb-3 text-[11.5px] text-t3">
          {call.customerName ?? "Unknown caller"} · {call.agentName}
        </div>

        <Waveform bars={9} tone={tone} height={22} className="mb-3" />

        <SentimentMeter score={call.sentimentScore} sentiment={call.sentiment} className="mb-3" />

        {call.transcriptPreview ? (
          <p className="mb-3 line-clamp-2 rounded-[10px] bg-white/[0.04] px-2.5 py-2 text-[11.5px] italic leading-snug text-t3">
            {call.transcriptPreview}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={listening ? "primary" : "ghost"}
            className="flex-1"
            onClick={onListen}
          >
            <Headphones className="size-3.5" />
            {listening ? "Listening" : "Listen"}
          </Button>
          {hot ? (
            <Button size="sm" variant="danger" className="flex-1" onClick={onTakeover}>
              Take over
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="flex-1" onClick={onTransfer}>
              Transfer
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function makePcmPlayer() {
  let ctx: AudioContext | null = null;
  let next = 0;
  return {
    push(b64: string, sampleRate: number) {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (raw.byteLength < 2) return;
      const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
      ctx ??= new AudioContext({ sampleRate });
      const f32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
      const buf = ctx.createBuffer(1, f32.length, sampleRate);
      buf.copyToChannel(f32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const t = Math.max(ctx.currentTime, next);
      src.start(t);
      next = t + buf.duration;
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}
