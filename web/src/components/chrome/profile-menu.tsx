"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Eraser, LogOut, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import { mutations } from "@/lib/api/client";
import type { SessionUser } from "@/lib/api/schemas";
import { initialsOf } from "@/lib/utils";
import { AnchoredPopover } from "@/components/ui/popover";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/controls";

type Action = "erase" | "reset" | "delete";

const ACTIONS: Record<
  Action,
  {
    title: string;
    sub: string;
    bullets: string[];
    keeps?: string;
    confirmWord: string;
    cta: string;
    doneTitle: string;
  }
> = {
  erase: {
    title: "Erase call history",
    sub: "Agents, flows, knowledge and numbers stay exactly as they are.",
    bullets: [
      "Every call, transcript, recording and tool log",
      "Customers the agents remember — so a test number is a stranger again",
      "Complaints, bookings, alerts and usage from those calls",
    ],
    keeps: "Campaign contacts go back to queued so you can re-run a campaign.",
    confirmWord: "ERASE",
    cta: "Erase history",
    doneTitle: "Call history erased",
  },
  reset: {
    title: "Reset workspace",
    sub: "Back to a fresh account — like you just signed up.",
    bullets: [
      "All agents, their versions and flows",
      "Departments, desks, appointment types and knowledge",
      "Campaigns, integrations, templates and every call",
    ],
    keeps: "Your login, phone numbers and billing stay. Voices go back to stock.",
    confirmWord: "RESET",
    cta: "Reset workspace",
    doneTitle: "Workspace reset",
  },
  delete: {
    title: "Delete account",
    sub: "This removes your login. If you are the only member, the whole workspace goes with it.",
    bullets: [
      "Your user, sessions and API access",
      "If nobody else is in the workspace: agents, calls, numbers, invoices — everything",
    ],
    confirmWord: "DELETE",
    cta: "Delete my account",
    doneTitle: "Account deleted",
  },
};

export function ProfileMenu({ user }: { user: SessionUser | undefined }) {
  const router = useRouter();
  const qc = useQueryClient();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";
  const canReset = user?.role === "owner" || user?.role === "admin";

  const begin = (a: Action) => {
    setOpen(false);
    setTyped("");
    setResult(null);
    setAction(a);
  };

  const close = () => {
    if (busy) return;
    setAction(null);
    setResult(null);
  };

  const signOut = async () => {
    setOpen(false);
    try {
      await mutations.logout();
    } finally {
      qc.clear();
      router.push("/login");
    }
  };

  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action === "erase") {
        await mutations.eraseCallHistory();
        await qc.invalidateQueries();
        setResult({ ok: true, message: "Calls, customers and their traces are gone. Your agents are untouched." });
      } else if (action === "reset") {
        await mutations.resetWorkspace();
        await qc.invalidateQueries();
        setResult({ ok: true, message: "Fresh workspace. Open Swara to set up your agents again." });
      } else {
        await mutations.deleteAccount();
        qc.clear();
        router.push("/login");
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const spec = action ? ACTIONS[action] : null;
  const confirmed = spec ? typed.trim().toUpperCase() === spec.confirmWord : false;

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-[34px] items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-xs font-semibold text-[#1a0e08] transition-transform hover:scale-[1.04]"
        style={{ background: "linear-gradient(135deg, var(--color-amber), var(--color-coral))" }}
        title={user ? `${user.name}${roleLabel ? ` · ${roleLabel}` : ""}` : "Account"}
      >
        {user ? initialsOf(user.name) : "·"}
      </button>

      <AnchoredPopover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={300} label="Account">
        <div className="border-b border-hairline px-4 py-3">
          <div className="truncate font-[family-name:var(--font-display)] text-[13.5px] font-semibold text-t1">
            {user?.name ?? "Account"}
          </div>
          <div className="truncate text-[11.5px] text-t3">{user?.email}</div>
          {roleLabel ? (
            <div className="mt-1 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wide text-t3">
              {roleLabel}
              {user?.departmentName ? ` · ${user.departmentName}` : ""}
            </div>
          ) : null}
        </div>

        <div className="p-1.5">
          <MenuItem icon={LogOut} label="Sign out" onClick={signOut} />
        </div>

        <div className="border-t border-hairline p-1.5">
          <div className="px-2.5 pb-1 pt-1.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wide text-t3">
            Data
          </div>
          <MenuItem
            icon={Eraser}
            label="Erase call history"
            hint="Keep agents, forget every caller"
            onClick={() => begin("erase")}
          />
          {canReset ? (
            <MenuItem
              icon={RotateCcw}
              label="Reset workspace"
              hint="Fresh profile, nothing built"
              onClick={() => begin("reset")}
            />
          ) : null}
          <MenuItem icon={Trash2} label="Delete account" danger onClick={() => begin("delete")} />
        </div>
      </AnchoredPopover>

      <Modal
        open={action !== null}
        onClose={close}
        title={result?.ok && spec ? spec.doneTitle : spec?.title}
        sub={result ? undefined : spec?.sub}
        width={480}
        footer={
          result?.ok ? (
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="subtle" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={run} disabled={!confirmed || busy}>
                {busy ? "Working…" : spec?.cta}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <p className={`text-[13px] leading-relaxed ${result.ok ? "text-t2" : "text-coral"}`}>{result.message}</p>
        ) : spec ? (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-t3">This removes</div>
              <ul className="space-y-1 text-[13px] text-t2">
                {spec.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-coral/80" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {spec.keeps ? <p className="mt-2 text-[12px] text-t3">{spec.keeps}</p> : null}
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-t2">
                Type <span className="font-[family-name:var(--font-mono)] text-t1">{spec.confirmWord}</span> to
                confirm. This cannot be undone.
              </div>
              <TextInput
                value={typed}
                onChange={setTyped}
                placeholder={spec.confirmWord}
                autoFocus
                onSubmit={() => {
                  if (confirmed) void run();
                }}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06] ${
        danger ? "text-coral" : "text-t1"
      }`}
    >
      <Icon className={`size-[14px] shrink-0 ${danger ? "text-coral" : "text-t3"}`} strokeWidth={1.7} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-tight">{label}</span>
        {hint ? <span className="block text-[11px] leading-tight text-t3">{hint}</span> : null}
      </span>
    </button>
  );
}
