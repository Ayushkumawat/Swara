"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput, Toggle } from "@/components/ui/controls";
import { NODE_KIND_HELP, NODE_KIND_LABEL, TOOL_OPTIONS, nodeConfig, type NodeConfig } from "@/lib/agents/flow";
import type { FlowEdge, FlowNode } from "@/lib/api/schemas";

/**
 * Per-node configuration. Each kind exposes only what the runtime reads:
 * the script for say/start, the fields for collect, the tool for data_pull,
 * the desk for transfer, the sibling agent for handoff. Nothing decorative.
 */
export function NodeInspector({
  node,
  outgoing,
  agents,
  transfers,
  appointmentTypes,
  onChange,
  onDelete,
  onRelabelEdge,
  onDeleteEdge,
}: {
  node: FlowNode;
  outgoing: FlowEdge[];
  agents: { id: string; name: string }[];
  transfers: string[];
  appointmentTypes: string[];
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
  onRelabelEdge: (id: string, label: string) => void;
  onDeleteEdge: (id: string) => void;
}) {
  const cfg = nodeConfig(node);
  const setCfg = (patch: Partial<NodeConfig>) => onChange({ config: { ...cfg, ...patch } });

  return (
    <div className="space-y-3.5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.08em] text-t3">{NODE_KIND_LABEL[node.kind]}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-t3">{NODE_KIND_HELP[node.kind]}</p>
      </div>

      <Field label="Title">
        <TextInput value={node.title} onChange={(v) => onChange({ title: v })} placeholder="What this step does" />
      </Field>

      {node.kind === "start" || node.kind === "say" || node.kind === "end" ? (
        <Field
          label={node.kind === "end" ? "Closing line (optional)" : "Line to say"}
          hint={node.kind === "start" ? "Leave empty to let the persona greet naturally. Never mention language." : undefined}
        >
          <textarea
            value={cfg.script ?? ""}
            onChange={(e) => setCfg({ script: e.target.value })}
            rows={3}
            className="glass w-full resize-y rounded-[12px] p-3 text-[12.5px] leading-relaxed text-t1 outline-none"
            placeholder={node.kind === "end" ? "Thank you for calling, have a good day." : "Namaste, main Riya bol rahi hoon…"}
          />
        </Field>
      ) : null}

      {node.kind === "collect" ? (
        <Field label="Fields to collect" hint="One per line. Asked one at a time and read back.">
          <textarea
            value={(cfg.fields ?? []).join("\n")}
            onChange={(e) => setCfg({ fields: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            rows={4}
            className="glass w-full resize-y rounded-[12px] p-3 font-[family-name:var(--font-mono)] text-[12px] text-t1 outline-none"
            placeholder={"name\nphone\norder ID"}
          />
        </Field>
      ) : null}

      {node.kind === "data_pull" ? (
        <Field label="Tool">
          <Select
            size="sm"
            value={cfg.tool ?? ""}
            onChange={(v) => setCfg({ tool: v || undefined })}
            options={[{ value: "", label: "Let the model choose" }, ...TOOL_OPTIONS.map((t) => ({ value: t.value as string, label: t.label }))]}
          />
        </Field>
      ) : null}

      {node.kind === "book" ? (
        <Field label="Appointment type" hint={appointmentTypes.length ? undefined : "None configured — add one in Workspace setup → Appointments."}>
          <Select
            size="sm"
            value={cfg.appointmentType ?? ""}
            onChange={(v) => setCfg({ appointmentType: v || undefined })}
            options={[{ value: "", label: "Any configured type" }, ...appointmentTypes.map((t) => ({ value: t, label: t }))]}
          />
        </Field>
      ) : null}

      {node.kind === "escalate" ? (
        <Field label="Transfer desk" hint={transfers.length ? undefined : "No desk configured — add one in Workspace setup → Transfers, or the agent takes a callback."}>
          <Select
            size="sm"
            value={cfg.transferTarget ?? ""}
            onChange={(v) => setCfg({ transferTarget: v || undefined })}
            options={[{ value: "", label: "Best match for the reason" }, ...transfers.map((t) => ({ value: t, label: t }))]}
          />
        </Field>
      ) : null}

      {node.kind === "handoff" ? (
        <Field label="Hand off to agent" hint="The other agent continues the same call with a summary of what happened so far.">
          <Select
            size="sm"
            value={cfg.agentId ?? ""}
            onChange={(v) => setCfg({ agentId: v || undefined })}
            placeholder="Choose an agent…"
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
      ) : null}

      {node.kind === "end" ? (
        <Toggle checked={cfg.hangUp !== false} onChange={(v) => setCfg({ hangUp: v })} label="Hang up after the closing line" />
      ) : null}

      <Field label="Extra instruction (optional)" hint="Anything the model should know at this step.">
        <textarea
          value={cfg.note ?? ""}
          onChange={(e) => setCfg({ note: e.target.value })}
          rows={2}
          className="glass w-full resize-y rounded-[12px] p-3 text-[12px] text-t1 outline-none"
          placeholder="e.g. If they mention a refund amount, do not confirm it."
        />
      </Field>

      {outgoing.length ? (
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-t2">Branches out of this step</div>
          <div className="space-y-1.5">
            {outgoing.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <input
                  value={e.label ?? ""}
                  onChange={(ev) => onRelabelEdge(e.id, ev.target.value)}
                  placeholder="when…"
                  className="glass min-w-0 flex-1 rounded-[10px] px-2.5 py-1.5 text-[12px] text-t1 outline-none"
                />
                <button
                  type="button"
                  onClick={() => onDeleteEdge(e.id)}
                  className="rounded p-1 text-t3 hover:bg-coral/15 hover:text-coral"
                  aria-label="Remove branch"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {node.kind !== "start" ? (
        <Button variant="danger" size="sm" full onClick={onDelete}>
          <Trash2 className="size-3.5" />
          Delete step
        </Button>
      ) : null}
    </div>
  );
}
