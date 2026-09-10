import type { FlowEdge, FlowNode } from "@/lib/api/schemas";

/**
 * Turns the canvas into instructions the live model must follow.
 *
 * The graph is not decoration: each node names a tool or a hang-up, and the
 * compiled text is injected into the system instruction at token-mint time.
 * A lookup node that is never compiled is a picture of a lookup, not a lookup.
 */

const TOOL_FOR_KIND: Partial<Record<FlowNode["kind"], string>> = {
  data_pull: "lookup_order or search_knowledge",
  book: "book_slot",
  escalate: "transfer_to_human or transfer_to_agent",
  end: "end_call",
};

function toolFor(n: FlowNode): string | undefined {
  const configured = n.config?.tool;
  if (typeof configured === "string" && configured) return configured;
  const hay = `${n.title} ${n.detail ?? ""}`.toLowerCase();
  if (n.kind === "data_pull") {
    if (hay.includes("register_complaint") || hay.includes("complaint")) return "register_complaint";
    if (hay.includes("lookup_order") || /\border\b/.test(hay)) return "lookup_order";
    if (hay.includes("knowledge") || hay.includes("policy") || hay.includes("search")) return "search_knowledge";
  }
  return TOOL_FOR_KIND[n.kind];
}

function describeNode(n: FlowNode, outs: FlowEdge[]): string {
  const tool = toolFor(n);
  const targetAgent = n.config?.targetAgentId as string | undefined;
  const targetName = n.config?.targetAgentName as string | undefined;
  const transferKind = n.config?.transferKind as string | undefined;
  const next =
    outs.length === 0
      ? "then stop at this step until you have what you need."
      : outs.length === 1
        ? `then go to: ${outs[0].label ? `${outs[0].label} → ` : ""}${outs[0].to}.`
        : `then branch: ${outs.map((e) => `${e.label || e.tone} → ${e.to}`).join("; ")}.`;

  switch (n.kind) {
    case "start":
      return `- START (${n.id}): Greet. Never ask which language. ${n.detail ?? ""} ${next}`;
    case "collect":
      return `- ASK (${n.id}) "${n.title}": Collect this one thing, confirm it back, do not skip. ${n.detail ?? ""} ${next}`;
    case "data_pull":
      return `- LOOK UP (${n.id}) "${n.title}": You MUST call ${tool} before saying any fact. Fillers while it runs. ${n.detail ?? ""} ${next}`;
    case "book":
      return `- BOOK (${n.id}) "${n.title}": Only after they agreed a specific slot, call book_slot. The booking does not exist until the tool says so. ${n.detail ?? ""} ${next}`;
    case "escalate":
      if (transferKind === "human") {
        return `- TRANSFER HUMAN (${n.id}) "${n.title}": Call transfer_to_human. Never invent a desk. ${n.detail ?? ""}`;
      }
      if (targetAgent || targetName) {
        return `- TRANSFER AGENT (${n.id}) "${n.title}": Call transfer_to_agent with "${targetName ?? targetAgent}". Announce in one line, then you ARE that agent — follow their knowledge. ${n.detail ?? ""}`;
      }
      return `- TRANSFER (${n.id}) "${n.title}": Call transfer_to_human or transfer_to_agent from your lists. Never invent a desk. ${n.detail ?? ""}`;
    case "end":
      return `- HANG UP (${n.id}): Say one short goodbye, then call end_call. Do not keep talking after. ${n.detail ?? ""}`;
    case "branch":
      return `- BRANCH (${n.id}) "${n.title}": ${n.detail ?? "Pick the matching path."} ${next}`;
    case "say":
      return `- SAY (${n.id}) "${n.title}": ${n.detail ?? n.title} ${next}`;
    case "intent":
      return `- INTENT (${n.id}) "${n.title}": Classify what they need, then take the matching path. ${next}`;
    default:
      return `- (${n.id}) ${n.title}: ${n.detail ?? ""} ${next}`;
  }
}

export function compileFlow(nodes: FlowNode[], edges: FlowEdge[]): string {
  if (!nodes.length) {
    return "CALL FLOW: no graph. Follow your role, use tools for facts, call end_call when finished.";
  }

  const outgoing = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }

  const lines = [
    "CALL FLOW — follow this procedure. A step that names a tool is mandatory: if you skip the tool, the action did not happen and you must not claim it did.",
    "When you reach an END step, or the caller is done, call end_call after a one-line goodbye.",
    "",
    ...nodes.map((n) => describeNode(n, outgoing.get(n.id) ?? [])),
  ];
  return lines.join("\n");
}
