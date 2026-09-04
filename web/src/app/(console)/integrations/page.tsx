"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Check, ExternalLink, Plus } from "lucide-react";
import { PageHead } from "@/components/chrome/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { SearchInput, Tabs } from "@/components/ui/controls";
import { CardSkeleton, QueryBoundary } from "@/components/ui/feedback";
import { Mono } from "@/components/ui/table";
import { LazyMount, Reveal } from "@/components/motion/primitives";
import { useIntegrations } from "@/lib/api/hooks";
import type { Integration } from "@/lib/api/schemas";
import { cn, relativeTime } from "@/lib/utils";

type Cat = "all" | Integration["category"];

const CATS: { value: Cat; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "logistics", label: "Logistics" },
  { value: "crm", label: "CRM" },
  { value: "messaging", label: "Messaging" },
  { value: "calendar", label: "Calendar" },
  { value: "developer", label: "Developer" },
  { value: "ops", label: "Ops" },
];

const ACCENT = {
  violet: "bg-violet/[0.16] text-violet",
  cyan: "bg-cyan/[0.14] text-cyan",
  amber: "bg-amber/[0.14] text-amber",
  coral: "bg-coral/[0.14] text-coral",
} as const;

export default function IntegrationsPage() {
  const query = useIntegrations();
  const [cat, setCat] = useState<Cat>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = query.data ?? [];
    if (cat !== "all") list = list.filter((i) => i.category === cat);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.blurb.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => a.priority - b.priority);
  }, [query.data, cat, search]);

  const connected = (query.data ?? []).filter((i) => i.status === "connected").length;

  return (
    <>
      <PageHead
        title="Integrations"
        sub={`Connect once, use across every agent · ${connected} connected`}
        actions={
          <Button variant="ghost" onClick={() => toast("Tell us what you need connected")}>
            <Plus className="size-3.5" />
            Request an integration
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs tabs={CATS} value={cat} onChange={setCat} size="sm" />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search integrations…"
          className="w-full sm:ml-auto sm:w-64"
        />
      </div>

      <QueryBoundary
        query={query}
        skeleton={
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <CardSkeleton key={i} height={150} />
            ))}
          </div>
        }
      >
        {() => (
          <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {filtered.map((i, idx) => (
              <IntegrationCard key={i.id} integration={i} index={idx} />
            ))}
          </motion.div>
        )}
      </QueryBoundary>

      <LazyMount className="mt-3.5">
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Reveal>
            <Card interactive={false} className="h-full">
              <CardHead
                title="Developer surface"
                sub="Shipped before the no-code builder is polished, on purpose"
              />
              <p className="mb-4 text-[12.5px] leading-relaxed text-t2">
                Technical buyers trust an API before they trust a visual builder. The REST API and
                webhooks cover everything the console does, so a customer who wants to drive
                campaigns from their own backend never hits a wall.
              </p>
              <div className="glass overflow-x-auto rounded-[12px] p-3.5">
                <pre className="font-[family-name:var(--font-mono)] text-[11.5px] leading-relaxed text-t2">
{`curl -X POST https://api.swara.in/v1/calls \\
  -H "Authorization: Bearer sk_live_…" \\
  -d '{
    "agent_id": "ag_delivery",
    "to": "+919876543210",
    "language": "hi",
    "context": { "order_id": "48213" }
  }'`}
                </pre>
              </div>
              <Button variant="ghost" full className="mt-3.5" onClick={() => toast("Docs coming with the API")}>
                <ExternalLink className="size-3.5" />
                API reference
              </Button>
            </Card>
          </Reveal>

          <Reveal delay={0.08}>
            <Card interactive={false} className="h-full">
              <CardHead
                title="MCP server"
                sub="Run campaigns from Claude or ChatGPT"
              />
              <p className="mb-4 text-[12.5px] leading-relaxed text-t2">
                Exposes agents, campaigns and call history as MCP tools, so a customer can say
                &ldquo;pause the Diwali campaign and tell me why connect rate dropped&rdquo; in their
                own assistant. This ships once the core API is stable — a placeholder card here
                would be worse than an honest date.
              </p>
              <div className="glass rounded-[12px] p-3.5">
                <Mono className="block text-[11px]">
                  npx @swara/mcp --api-key sk_live_…
                </Mono>
              </div>
              <div className="mt-3.5 flex items-center gap-2">
                <Pill tone="amber">Planned</Pill>
                <span className="text-[11.5px] text-t3">After REST API v1 is frozen</span>
              </div>
            </Card>
          </Reveal>
        </div>
      </LazyMount>
    </>
  );
}

function IntegrationCard({ integration, index }: { integration: Integration; index: number }) {
  const [connected, setConnected] = useState(integration.status === "connected");
  const soon = integration.status === "coming_soon";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.035, 0.35), duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-start justify-between">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-[13px] font-semibold",
              ACCENT[integration.accent],
            )}
          >
            {integration.name.slice(0, 2)}
          </span>
          {connected ? (
            <Pill tone="cyan">
              <Check className="size-3" />
              Connected
            </Pill>
          ) : soon ? (
            <Pill tone="grey">Soon</Pill>
          ) : null}
        </div>

        <div className="text-[13px] font-medium text-t1">{integration.name}</div>
        <p className="mt-1 flex-1 text-[11.5px] leading-snug text-t3">{integration.blurb}</p>

        {connected && integration.detail ? (
          <Mono className="mt-2 block text-[10.5px]">{integration.detail}</Mono>
        ) : null}

        <Button
          size="sm"
          variant={connected ? "subtle" : soon ? "subtle" : "ghost"}
          full
          disabled={soon}
          className="mt-3"
          onClick={() => {
            setConnected(!connected);
            toast.success(
              connected ? `${integration.name} disconnected` : `${integration.name} connected`,
            );
          }}
        >
          {soon ? "Not available yet" : connected ? "Manage" : "Connect"}
        </Button>

        {connected && integration.connectedAt ? (
          <span className="mt-1.5 text-center text-[10px] text-t3">
            Connected {relativeTime(integration.connectedAt)}
          </span>
        ) : null}
      </Card>
    </motion.div>
  );
}
