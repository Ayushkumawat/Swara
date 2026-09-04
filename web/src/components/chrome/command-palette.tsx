"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  useAgents,
  useCampaigns,
  useComplaints,
  useCustomers,
  useLiveCalls,
} from "@/lib/api/hooks";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { useUi } from "@/lib/ui-store";
import { INTENT_LABEL } from "@/lib/api/schemas";
import { maskPhone } from "@/lib/utils";

/**
 * ⌘K palette.
 *
 * A supervisor watching a wall of calls should never have to hunt through a
 * sidebar to reach one customer. This searches navigation, agents, campaigns,
 * complaints, customers and live calls in one place, and exposes the actions
 * that would otherwise be buried on their own screens.
 */
export function CommandPalette() {
  const router = useRouter();
  const open = useUi((s) => s.paletteOpen);
  const setPalette = useUi((s) => s.setPalette);
  const openCopilot = useUi((s) => s.openCopilot);
  const [search, setSearch] = useState("");

  const { data: agents } = useAgents();
  const { data: campaigns } = useCampaigns();
  const { data: complaints } = useComplaints();
  const { data: customers } = useCustomers();
  const { data: liveCalls } = useLiveCalls();

  const close = () => {
    setPalette(false);
    setSearch("");
  };

  const goTo = (href: string) => {
    close();
    router.push(href);
  };

  const openComplaints = useMemo(
    () => (complaints ?? []).filter((c) => c.stage !== "resolved"),
    [complaints],
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-start justify-center bg-void/70 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[600px]"
          >
            <Command
              loop
              className="glass-strong overflow-hidden rounded-[18px] shadow-[0_32px_80px_-20px_rgba(0,0,0,0.8)]"
            >
              <div className="flex items-center gap-2.5 border-b border-hairline px-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4 text-t3">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4-4" />
                </svg>
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search agents, campaigns, customers, or jump to a screen…"
                  className="w-full bg-transparent py-3.5 text-[13.5px] text-t1 outline-none placeholder:text-t3"
                />
                <kbd className="rounded border border-hairline px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-t3">
                  esc
                </kbd>
              </div>

              <Command.List className="max-h-[420px] overflow-y-auto p-2">
                <Command.Empty className="py-10 text-center text-[12.5px] text-t3">
                  Nothing matched “{search}”.
                </Command.Empty>

                <Group heading="Actions">
                  <Item
                    onSelect={() => {
                      close();
                      openCopilot();
                    }}
                    icon="✦"
                    label="Ask the copilot to edit a flow"
                    hint="AI"
                  />
                  <Item
                    onSelect={() => goTo("/agents?new=1")}
                    icon="+"
                    label="Create a new agent"
                  />
                  <Item
                    onSelect={() => goTo("/campaigns?new=1")}
                    icon="+"
                    label="Start a new outbound campaign"
                  />
                  <Item
                    onSelect={() => {
                      close();
                      toast.success("Test call queued", {
                        description: "Calling your verified number in a few seconds.",
                      });
                    }}
                    icon="☎"
                    label="Place a test call"
                  />
                </Group>

                <Group heading="Go to">
                  {ALL_NAV_ITEMS.map((item) => (
                    <Item
                      key={item.href}
                      value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                      onSelect={() => goTo(item.href)}
                      icon={<item.icon className="size-[15px]" strokeWidth={1.7} />}
                      label={item.label}
                    />
                  ))}
                </Group>

                {liveCalls?.length ? (
                  <Group heading="Live right now">
                    {liveCalls.map((c) => (
                      <Item
                        key={c.id}
                        value={`${c.customerName} ${c.phone} ${c.agentName} live call`}
                        onSelect={() => goTo("/live")}
                        icon="●"
                        iconClass={c.sentiment === "frustrated" ? "text-coral" : "text-cyan"}
                        label={`${c.customerName ?? maskPhone(c.phone)} — ${INTENT_LABEL[c.intent]}`}
                        hint={c.agentName}
                      />
                    ))}
                  </Group>
                ) : null}

                {agents?.length ? (
                  <Group heading="Agents">
                    {agents.map((a) => (
                      <Item
                        key={a.id}
                        value={`${a.name} agent ${a.status}`}
                        onSelect={() => goTo(`/agents?agent=${a.id}`)}
                        icon="◆"
                        label={a.name}
                        hint={a.status}
                      />
                    ))}
                  </Group>
                ) : null}

                {campaigns?.length ? (
                  <Group heading="Campaigns">
                    {campaigns.map((c) => (
                      <Item
                        key={c.id}
                        value={`${c.name} campaign`}
                        onSelect={() => goTo("/campaigns")}
                        icon="▶"
                        label={c.name}
                        hint={c.status}
                      />
                    ))}
                  </Group>
                ) : null}

                {openComplaints.length ? (
                  <Group heading="Open complaints">
                    {openComplaints.map((c) => (
                      <Item
                        key={c.id}
                        value={`${c.ref} ${c.title} complaint`}
                        onSelect={() => goTo("/complaints")}
                        icon="!"
                        iconClass="text-coral"
                        label={c.title}
                        hint={c.ref}
                      />
                    ))}
                  </Group>
                ) : null}

                {customers?.length ? (
                  <Group heading="Customers">
                    {customers.map((c) => (
                      <Item
                        key={c.id}
                        value={`${c.name} ${c.phone} customer`}
                        onSelect={() => goTo(`/customers?id=${c.id}`)}
                        icon="◉"
                        label={c.name}
                        hint={maskPhone(c.phone)}
                      />
                    ))}
                  </Group>
                ) : null}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.07em] [&_[cmdk-group-heading]]:text-t3"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  onSelect,
  icon,
  iconClass,
  label,
  hint,
  value,
}: {
  onSelect: () => void;
  icon: React.ReactNode;
  iconClass?: string;
  label: string;
  hint?: string;
  value?: string;
}) {
  return (
    <Command.Item
      value={value ?? label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px] text-t2 transition-colors data-[selected=true]:bg-white/[0.08] data-[selected=true]:text-t1"
    >
      <span
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-[7px] bg-white/[0.06] text-[11px] ${iconClass ?? "text-t2"}`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {hint ? (
        <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10.5px] text-t3">
          {hint}
        </span>
      ) : null}
    </Command.Item>
  );
}
