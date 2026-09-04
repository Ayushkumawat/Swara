"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Download, FileAudio, FileCheck2, PhoneCall, X } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill, severityTone } from "@/components/ui/pill";
import { CardSkeleton, QueryBoundary } from "@/components/ui/feedback";
import { SlaCountdown, useLiveClock } from "@/components/ui/live";
import { Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { useComplaints } from "@/lib/api/hooks";
import type { Complaint, ComplaintStage } from "@/lib/api/schemas";
import { cn, maskPhone, relativeTime } from "@/lib/utils";

const COLUMNS: { stage: ComplaintStage; label: string; accent: string }[] = [
  { stage: "new", label: "New", accent: "bg-violet" },
  { stage: "in_progress", label: "In progress", accent: "bg-cyan" },
  { stage: "escalated", label: "Escalated", accent: "bg-coral" },
  { stage: "resolved", label: "Resolved", accent: "bg-t3" },
];

export default function ComplaintsPage() {
  const query = useComplaints();
  const [stages, setStages] = useState<Record<string, ComplaintStage>>({});
  const [open, setOpen] = useState<Complaint | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<ComplaintStage | null>(null);
  const now = useLiveClock(30_000);

  const complaints = useMemo(
    () => (query.data ?? []).map((c) => ({ ...c, stage: stages[c.id] ?? c.stage })),
    [query.data, stages],
  );

  const breached = complaints.filter(
    (c) => c.stage !== "resolved" && now !== null && new Date(c.slaDueAt).getTime() < now,
  );

  const move = (id: string, stage: ComplaintStage) => {
    setStages((s) => ({ ...s, [id]: stage }));
    const label = COLUMNS.find((c) => c.stage === stage)?.label;
    toast.success(`Moved to ${label}`);
  };

  return (
    <>
      <PageHead
        title="Complaints & grievances"
        sub="Detected in real time, tracked to SLA, exportable for audit"
        actions={
          <Button variant="ghost" onClick={() => toast.success("Preparing audit export…")}>
            <Download className="size-3.5" />
            Export audit log
          </Button>
        }
      />

      {breached.length > 0 ? (
        <Reveal className="mb-3.5">
          <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-coral/25 bg-coral/[0.09] px-4 py-3">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-coral" />
            <span className="flex-1 text-[13px] text-t1">
              <span className="font-medium">
                {breached.length} complaint{breached.length > 1 ? "s have" : " has"} breached SLA
              </span>{" "}
              — {breached.map((c) => c.ref).join(", ")}
            </span>
          </div>
        </Reveal>
      ) : null}

      <QueryBoundary
        query={query}
        skeleton={
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} height={280} />
            ))}
          </div>
        }
      >
        {() => (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = complaints.filter((c) => c.stage === col.stage);
              const isTarget = hoverCol === col.stage && dragging !== null;

              return (
                <div
                  key={col.stage}
                  onPointerEnter={() => dragging && setHoverCol(col.stage)}
                  className={cn(
                    "rounded-[18px] p-2 transition-colors",
                    isTarget ? "bg-white/[0.05] ring-1 ring-cyan/35" : "bg-white/[0.015]",
                  )}
                >
                  <div className="mb-2.5 flex items-center gap-2 px-1.5 pt-1">
                    <span className={cn("size-1.5 rounded-full", col.accent)} />
                    <span className="text-xs font-semibold text-t2">{col.label}</span>
                    <Mono className="ml-auto text-[10.5px]">{items.length}</Mono>
                  </div>

                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {items.map((c) => (
                        <ComplaintCard
                          key={c.id}
                          complaint={c}
                          onOpen={() => setOpen(c)}
                          onDragStart={() => setDragging(c.id)}
                          onDragEnd={() => {
                            if (hoverCol && hoverCol !== c.stage) move(c.id, hoverCol);
                            setDragging(null);
                            setHoverCol(null);
                          }}
                        />
                      ))}
                    </AnimatePresence>
                    {items.length === 0 ? (
                      <div className="rounded-[12px] border border-dashed border-hairline px-3 py-6 text-center text-[11.5px] text-t3">
                        Nothing here
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </QueryBoundary>

      <Reveal className="mt-3.5">
        <Card interactive={false}>
          <CardHead
            title="Why every complaint keeps its recording, transcript and consent record"
            sub="Audit trail"
          />
          <p className="max-w-3xl text-[12.5px] leading-relaxed text-t2">
            A BFSI or insurance buyer will ask for the full artefact set on any disputed
            interaction. Retaining the links from the first call — rather than adding them when the
            first enterprise deal appears — is the difference between an export feature and a data
            migration. One complaint below is missing its consent record; that gap is visible
            deliberately.
          </p>
        </Card>
      </Reveal>

      <ComplaintDrawer complaint={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ComplaintCard({
  complaint,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  complaint: Complaint;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const now = useLiveClock(30_000);
  const breached =
    complaint.stage !== "resolved" &&
    now !== null &&
    new Date(complaint.slaDueAt).getTime() < now;

  return (
    <motion.div
      layout
      drag
      dragSnapToOrigin
      dragElastic={0.12}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileDrag={{ scale: 1.04, zIndex: 50, cursor: "grabbing" }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "glass-strong cursor-pointer rounded-[14px] p-3",
        breached && "border-coral/35 bg-coral/[0.08]",
      )}
    >
      <div className="mb-2 text-[12.5px] font-medium leading-snug text-t1">{complaint.title}</div>
      <div className="mb-2 text-[11px] text-t3">
        {complaint.customerName} · {complaint.category}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Mono className="text-[10.5px]">{complaint.ref}</Mono>
        <div className="flex items-center gap-1.5">
          {complaint.stage !== "resolved" ? <SlaCountdown dueAt={complaint.slaDueAt} /> : null}
          <Pill tone={severityTone[complaint.severity]}>{complaint.severity}</Pill>
        </div>
      </div>
    </motion.div>
  );
}

function ComplaintDrawer({
  complaint,
  onClose,
}: {
  complaint: Complaint | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {complaint ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-void/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="glass-strong fixed right-0 top-0 z-[95] flex h-full w-full max-w-[440px] flex-col border-l border-hairline"
          >
            <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Mono className="text-t1">{complaint.ref}</Mono>
                  <Pill tone={severityTone[complaint.severity]}>{complaint.severity}</Pill>
                </div>
                <h3 className="mt-1.5 font-[family-name:var(--font-display)] text-[15px] font-semibold leading-snug text-t1">
                  {complaint.title}
                </h3>
              </div>
              <button onClick={onClose} aria-label="Close" className="text-t3 hover:text-t1">
                <X className="size-4" />
              </button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3">
                <Detail label="Customer" value={complaint.customerName} />
                <Detail label="Phone" value={maskPhone(complaint.phone)} mono />
                <Detail label="Category" value={complaint.category} />
                <Detail label="Assignee" value={complaint.assignee ?? "Unassigned"} />
                <Detail label="Opened" value={relativeTime(complaint.openedAt)} />
                <Detail
                  label="SLA"
                  value={<SlaCountdown dueAt={complaint.slaDueAt} />}
                />
              </div>

              <div>
                <div className="mb-2 text-[11.5px] font-medium text-t2">Audit artefacts</div>
                <div className="space-y-2">
                  <Artefact
                    icon={<PhoneCall className="size-3.5" strokeWidth={1.7} />}
                    label={`Call transcript #${complaint.callId ?? "—"}`}
                    present={Boolean(complaint.callId)}
                  />
                  <Artefact
                    icon={<FileAudio className="size-3.5" strokeWidth={1.7} />}
                    label="Call recording"
                    present={complaint.hasRecording}
                  />
                  <Artefact
                    icon={<FileCheck2 className="size-3.5" strokeWidth={1.7} />}
                    label="Consent record"
                    present={complaint.hasConsent}
                  />
                </div>
                {!complaint.hasConsent ? (
                  <p className="mt-2.5 rounded-[10px] border border-amber/20 bg-amber/[0.07] p-2.5 text-[11.5px] leading-snug text-t2">
                    No consent artefact on this one. It predates consent capture being enabled on
                    all flows — worth noting before this complaint is ever handed to a regulator.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2 border-t border-hairline p-4">
              <Button variant="ghost" className="flex-1" onClick={() => toast.success("Callback queued")}>
                Call back
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  toast.success("Marked resolved");
                  onClose();
                }}
              >
                Mark resolved
              </Button>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-t3">{label}</div>
      <div
        className={cn(
          "mt-1 text-[12.5px] text-t1",
          mono && "font-[family-name:var(--font-mono)] text-xs",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Artefact({
  icon,
  label,
  present,
}: {
  icon: React.ReactNode;
  label: string;
  present: boolean;
}) {
  return (
    <div className="glass flex items-center gap-2.5 rounded-[11px] px-3 py-2.5">
      <span className={present ? "text-cyan" : "text-t3"}>{icon}</span>
      <span className="flex-1 text-[12.5px] text-t2">{label}</span>
      <Pill tone={present ? "cyan" : "amber"}>{present ? "Retained" : "Missing"}</Pill>
    </div>
  );
}
