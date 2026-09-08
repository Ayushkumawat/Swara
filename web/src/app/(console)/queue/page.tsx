"use client";

/**
 * The department work queue — the screen the user's metro example describes.
 *
 * A cleaning supervisor and a maintenance engineer don't want a call-centre
 * console; they want "what do I have to fix, how urgent, by when". This page
 * is that list. The server scopes it: a user attached to a department sees
 * only their department's actions, an org-wide role sees everything with a
 * filter. Actions arrive from live calls — either the agent registering a
 * complaint mid-call or the post-call pipeline classifying the transcript —
 * and closing the last action on a complaint resolves the complaint itself.
 */

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck, CircleDot, Hammer, Inbox } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill, severityTone } from "@/components/ui/pill";
import { CardSkeleton, QueryBoundary } from "@/components/ui/feedback";
import { SlaCountdown, useLiveClock } from "@/components/ui/live";
import { Mono } from "@/components/ui/table";
import { Reveal } from "@/components/motion/primitives";
import { IS_MOCK, mutations } from "@/lib/api/client";
import { qk, useActions, useMe } from "@/lib/api/hooks";
import type { ActionItem } from "@/lib/api/schemas";
import { cn, relativeTime } from "@/lib/utils";

const LANES = [
  { status: "open" as const, label: "To do", icon: Inbox, accent: "text-coral" },
  { status: "in_progress" as const, label: "Working on it", icon: Hammer, accent: "text-cyan" },
  { status: "done" as const, label: "Done", icon: CheckCheck, accent: "text-t3" },
];

export default function QueuePage() {
  const query = useActions();
  const me = useMe();
  const queryClient = useQueryClient();
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const now = useLiveClock(30_000);

  const scoped = Boolean(me.data?.user.departmentId);
  const actions = useMemo(() => query.data ?? [], [query.data]);

  const departmentNames = useMemo(
    () => [...new Set(actions.map((a) => a.department))].sort(),
    [actions],
  );
  const visible = deptFilter ? actions.filter((a) => a.department === deptFilter) : actions;

  const setStatus = async (action: ActionItem, status: ActionItem["status"]) => {
    // Optimistic: the queue is worked on a phone in a metro corridor; a
    // spinner per tap would make it unusable.
    queryClient.setQueryData<ActionItem[]>(qk.actions, (old) =>
      (old ?? []).map((a) => (a.id === action.id ? { ...a, status } : a)),
    );
    try {
      if (!IS_MOCK) await mutations.updateAction(action.id, status);
      toast.success(
        status === "done" ? `Done — ${action.title}` : `Moved to ${status.replace("_", " ")}`,
      );
      void queryClient.invalidateQueries({ queryKey: qk.actions });
      void queryClient.invalidateQueries({ queryKey: qk.complaints });
    } catch {
      toast.error("Could not update — check your connection");
      void queryClient.invalidateQueries({ queryKey: qk.actions });
    }
  };

  const overdue = visible.filter(
    (a) => a.status !== "done" && a.dueAt && now !== null && new Date(a.dueAt).getTime() < now,
  ).length;

  return (
    <>
      <PageHead
        title={
          scoped && me.data?.user.departmentName
            ? `${me.data.user.departmentName} — queue`
            : "Action queue"
        }
        sub={
          scoped
            ? "Work routed to your department from live calls, ordered by deadline"
            : "Everything the calls produced, routed by department"
        }
        actions={
          overdue > 0 ? (
            <Pill tone="coral" dot>
              {overdue} overdue
            </Pill>
          ) : undefined
        }
      />

      {/* Org-wide users pick a department; department users are already scoped
          server-side and never see this row. */}
      {!scoped && departmentNames.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <FilterChip active={deptFilter === null} onClick={() => setDeptFilter(null)}>
            All departments
          </FilterChip>
          {departmentNames.map((name) => (
            <FilterChip key={name} active={deptFilter === name} onClick={() => setDeptFilter(name)}>
              {name}
            </FilterChip>
          ))}
        </div>
      ) : null}

      <QueryBoundary
        query={query}
        skeleton={<CardSkeleton height={420} />}
        empty={
          <Card interactive={false} className="p-10 text-center">
            <CircleDot className="mx-auto size-6 text-t3" />
            <p className="mt-3 text-[14px] font-medium text-t1">Queue is clear</p>
            <p className="mx-auto mt-1 max-w-[380px] text-[12.5px] text-t3">
              Actions appear here when calls produce work — a complaint registered mid-call, or
              follow-ups the post-call analysis routes to a department.
            </p>
          </Card>
        }
      >
        {() => (
          <div className="grid gap-4 lg:grid-cols-3">
            {LANES.map((lane) => {
              const items = visible.filter((a) => a.status === lane.status);
              return (
                <div key={lane.status}>
                  <div className="mb-2.5 flex items-center gap-2 px-1">
                    <lane.icon className={cn("size-3.5", lane.accent)} />
                    <span className="text-[12px] font-medium text-t2">{lane.label}</span>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-t3">
                      {items.length}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {items.map((action, i) => (
                      <Reveal key={action.id} delay={i * 0.03}>
                        <ActionCard action={action} showDept={!scoped && !deptFilter} onStatus={setStatus} />
                      </Reveal>
                    ))}
                    {items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-[11.5px] text-t3">
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
    </>
  );
}

function ActionCard({
  action,
  showDept,
  onStatus,
}: {
  action: ActionItem;
  showDept: boolean;
  onStatus: (action: ActionItem, status: ActionItem["status"]) => void;
}) {
  return (
    <Card interactive={false} className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={severityTone[action.severity]}>{action.severity}</Pill>
            {showDept ? <Pill tone="grey">{action.department}</Pill> : null}
            {action.complaintRef ? <Mono className="text-[10.5px]">{action.complaintRef}</Mono> : null}
          </div>
          <p className="mt-2 text-[13px] font-medium leading-snug text-t1">{action.title}</p>
          {action.detail ? (
            <p className="mt-1 text-[11.5px] leading-snug text-t3">{action.detail}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-2.5">
        <span className="text-[11px] text-t3">
          {action.status !== "done" && action.dueAt ? (
            <SlaCountdown dueAt={action.dueAt} />
          ) : (
            relativeTime(action.createdAt)
          )}
        </span>
        <div className="flex gap-1.5">
          {action.status === "open" ? (
            <Button size="sm" variant="ghost" onClick={() => onStatus(action, "in_progress")}>
              Start
            </Button>
          ) : null}
          {action.status !== "done" ? (
            <motion.div whileTap={{ scale: 0.96 }}>
              <Button size="sm" variant="primary" onClick={() => onStatus(action, "done")}>
                <CheckCheck className="size-3.5" />
                Done
              </Button>
            </motion.div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onStatus(action, "open")}>
              Reopen
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
        active
          ? "border-cyan/40 bg-cyan/10 text-cyan"
          : "border-hairline text-t3 hover:border-white/20 hover:text-t2",
      )}
    >
      {children}
    </button>
  );
}
