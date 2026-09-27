import type { FlowEdge, FlowNode, FlowNodeKind } from "@/lib/api/schemas";

/**
 * The flow graph is the agent's plan, not a picture of one.
 *
 * A native-audio model cannot be stepped node by node — it hears and speaks
 * continuously. What it *can* follow is an explicit, ordered script with named
 * branches and named tool calls. `compileFlow` turns the graph into that
 * script, and `composeLivePrompt` puts it in the system instruction. Every
 * node kind maps to something the runtime actually does: a tool call, a
 * transfer, a handoff to another agent, or hanging up.
 */

export type NodeConfig = {
  /** say / start: the line to speak. */
  script?: string;
  /** collect: fields to gather one at a time. */
  fields?: string[];
  /** intent / branch: the options the caller can take, keyed by edge label. */
  options?: string[];
  /** data_pull: which tool to call. */
  tool?: string;
  /** book: which appointment type. */
  appointmentType?: string;
  /** escalate: which transfer desk (by name). Empty = the best match. */
  transferTarget?: string;
  /** handoff: which other agent (id) takes over. */
  agentId?: string;
  /** end: whether the agent hangs up after the closing line. */
  hangUp?: boolean;
  /** Any node: extra instruction for the model at this step. */
  note?: string;
};

export const NODE_KIND_LABEL: Record<FlowNodeKind, string> = {
  start: "Start",
  intent: "Detect intent",
  data_pull: "Look something up",
  branch: "Branch",
  say: "Say",
  collect: "Collect",
  book: "Book",
  escalate: "Transfer to human",
  handoff: "Hand off to agent",
  end: "End call",
};

export const NODE_KIND_HELP: Record<FlowNodeKind, string> = {
  start: "The opening line. Never asks which language — it follows the caller.",
  intent: "Work out what the caller wants and take the matching branch.",
  data_pull: "Call a tool (order lookup, knowledge search) before answering.",
  branch: "Choose a path from the tool result or the caller's answer.",
  say: "A fixed line the agent must deliver at this point.",
  collect: "Ask for these details one at a time and read them back.",
  book: "Confirm a slot with book_slot. Only configured types are allowed.",
  escalate: "Warm transfer to a configured human desk via transfer_to_human.",
  handoff: "Pass the caller to another agent that owns this topic, with context.",
  end: "Close warmly, then hang up with end_call.",
};

export const TOOL_OPTIONS = [
  { value: "lookup_order", label: "lookup_order — order status" },
  { value: "search_knowledge", label: "search_knowledge — policies, FAQs" },
  { value: "register_complaint", label: "register_complaint — file a complaint" },
];

export function nodeConfig(node: FlowNode): NodeConfig {
  return (node.config ?? {}) as NodeConfig;
}

/** Outgoing edges, ordered so the compiled script is deterministic. */
function outgoing(edges: FlowEdge[], id: string) {
  return edges.filter((e) => e.from === id);
}

export type FlowIssue = { level: "error" | "warn"; nodeId?: string; message: string };

/**
 * What would stop this flow working on a real call. Errors block publish;
 * warnings are shown but do not.
 */
export function validateFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  ctx: { transfers: string[]; appointmentTypes: string[]; agents: { id: string; name: string }[] },
): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const starts = nodes.filter((n) => n.kind === "start");
  if (nodes.length && starts.length === 0) issues.push({ level: "error", message: "No Start node." });
  if (starts.length > 1) issues.push({ level: "warn", message: "More than one Start node; only the first is used." });

  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      issues.push({ level: "error", message: `Edge ${e.id} points at a missing node.` });
    }
  }

  const reachable = new Set<string>();
  const queue = starts.slice(0, 1).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of outgoing(edges, id)) queue.push(e.to);
  }

  for (const n of nodes) {
    const cfg = nodeConfig(n);
    if (n.kind !== "start" && !reachable.has(n.id)) {
      issues.push({ level: "warn", nodeId: n.id, message: `"${n.title}" is not reachable from Start.` });
    }
    if (n.kind !== "end" && n.kind !== "handoff" && n.kind !== "escalate" && outgoing(edges, n.id).length === 0) {
      issues.push({ level: "warn", nodeId: n.id, message: `"${n.title}" has no next step — the call will drift.` });
    }
    if (n.kind === "escalate" && ctx.transfers.length === 0) {
      issues.push({ level: "error", nodeId: n.id, message: "Transfer step, but no transfer desk is configured in Workspace setup." });
    }
    if (n.kind === "escalate" && cfg.transferTarget && !ctx.transfers.includes(cfg.transferTarget)) {
      issues.push({ level: "warn", nodeId: n.id, message: `Desk "${cfg.transferTarget}" no longer exists.` });
    }
    if (n.kind === "book" && ctx.appointmentTypes.length === 0) {
      issues.push({ level: "error", nodeId: n.id, message: "Booking step, but no appointment types are configured." });
    }
    if (n.kind === "handoff" && !cfg.agentId) {
      issues.push({ level: "error", nodeId: n.id, message: `"${n.title}" needs a target agent.` });
    }
    if (n.kind === "handoff" && cfg.agentId && !ctx.agents.some((a) => a.id === cfg.agentId)) {
      issues.push({ level: "error", nodeId: n.id, message: `"${n.title}" points at an agent that no longer exists.` });
    }
    if (n.kind === "data_pull" && !cfg.tool) {
      issues.push({ level: "warn", nodeId: n.id, message: `"${n.title}" does not name a tool; the model will pick one.` });
    }
  }

  const hasEnd = nodes.some((n) => n.kind === "end" || n.kind === "handoff" || n.kind === "escalate");
  if (nodes.length && !hasEnd) issues.push({ level: "warn", message: "No End, Transfer or Handoff — the agent has no way to finish." });

  return issues;
}

/**
 * Graph → spoken plan.
 *
 * Depth-first from Start. Each node becomes a numbered step; branches list
 * their labelled options with the step each leads to. Tool nodes name the
 * tool. This is the text the model actually executes against.
 */
export function compileFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  ctx: { agents: { id: string; name: string }[]; allowTransfer?: boolean },
): string {
  if (nodes.length === 0) return "";
  const start = nodes.find((n) => n.kind === "start") ?? nodes[0];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const order: FlowNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const n = byId.get(id);
    if (!n) return;
    seen.add(id);
    order.push(n);
    for (const e of outgoing(edges, id)) visit(e.to);
  };
  visit(start.id);
  for (const n of nodes) if (!seen.has(n.id)) visit(n.id);

  const stepNo = new Map(order.map((n, i) => [n.id, i + 1]));
  const ref = (id: string) => {
    const n = byId.get(id);
    return n ? `step ${stepNo.get(id)} (${n.title})` : "the next step";
  };

  const lines: string[] = [
    "CALL SHAPE — the order a typical call takes. It is a map, not a script: listen to what the caller actually says, and skip any step that is already satisfied. Never ask for a detail the caller has already given. Never read step names or numbers aloud.",
  ];

  for (const n of order) {
    const cfg = nodeConfig(n);
    const outs = outgoing(edges, n.id);
    const next = outs.length === 1 ? ` Then go to ${ref(outs[0].to)}.` : "";
    const note = cfg.note ? ` ${cfg.note}` : "";
    const head = `${stepNo.get(n.id)}. ${n.title}`;

    switch (n.kind) {
      case "start":
        lines.push(`${head}: open the call in one sentence — your name, where you are calling from or answering for, then an open question or the reason you called.${cfg.script ? ` Say: "${cfg.script}"` : ""} Then stop and listen. Follow the caller's language from their first words.${next}${note}`);
        break;
      case "say":
        lines.push(`${head}: say${cfg.script ? `: "${cfg.script}"` : " this in one or two sentences"}.${next}${note}`);
        break;
      case "collect": {
        const fields = cfg.fields?.length ? cfg.fields.join(", ") : n.detail || "the details you need";
        lines.push(`${head}: you need ${fields}. Ask only for what you do not already have, one thing per turn, in a natural sentence that says why. Repeat back numbers and spellings once; do not repeat back anything else.${next}${note}`);
        break;
      }
      case "intent":
      case "branch": {
        if (outs.length === 0) {
          lines.push(`${head}: decide ${n.detail || "what the caller needs"}.${note}`);
        } else {
          const opts = outs
            .map((e) => `if ${e.label || byId.get(e.to)?.title || "so"} → ${ref(e.to)}`)
            .join("; ");
          lines.push(`${head}: ${n.kind === "intent" ? "work out what the caller wants from what they say — ask one open question only if it is not clear" : n.detail || "decide"}: ${opts}.${note}`);
        }
        break;
      }
      case "data_pull":
        lines.push(`${head}: call ${cfg.tool ?? "the relevant tool"} and answer only from its result. Say one short natural line while it runs ("ek second, dekhti hoon"), not a speech.${next}${note}`);
        break;
      case "book":
        lines.push(`${head}: offer two concrete slots${cfg.appointmentType ? ` for "${cfg.appointmentType}"` : ""}, confirm date, time and location, then call book_slot. Not booked until the tool says so.${next}${note}`);
        break;
      case "escalate":
        if (ctx.allowTransfer === false) {
          lines.push(`${head}: there is no human to transfer to. Say that in one sentence, take their name if you do not have it, confirm the number they are calling from is fine for a callback, and do not call transfer_to_human.${note}`);
          break;
        }
        lines.push(`${head}: tell the caller you are connecting them${cfg.transferTarget ? ` to ${cfg.transferTarget}` : " to a colleague"}, then call transfer_to_human${cfg.transferTarget ? ` with target_name "${cfg.transferTarget}"` : ""}. This ends your part of the call.${note}`);
        break;
      case "handoff": {
        const target = ctx.agents.find((a) => a.id === cfg.agentId);
        lines.push(`${head}: say one sentence that you are passing them to ${target?.name ?? "the right team"}, then call handoff_to_agent with agent_name "${target?.name ?? ""}" and a two-line summary of the call so far. Do not greet again after — the other agent continues.${note}`);
        break;
      }
      case "end":
        lines.push(
          cfg.script
            ? `${head}: say "${cfg.script}", then call end_call.${cfg.hangUp === false ? " Wait for the caller to hang up." : ""}${note}`
            : `${head}: this is two turns, never one. First turn: ask only "is there anything else?" and stop. Wait. If they bring up something new, you are not at this step any more. Second turn, only after they say no or say bye: one warm closing sentence, then call end_call.${cfg.hangUp === false ? " Wait for the caller to hang up." : ""}${note}`,
        );
        break;
    }
  }

  return lines.join("\n");
}

/** Sensible default title + config when a node is added from the palette. */
export function newNode(kind: FlowNodeKind, x: number, y: number): FlowNode {
  const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const defaults: Record<FlowNodeKind, Partial<FlowNode> & { config: NodeConfig }> = {
    start: { title: "Greet", config: { script: "" } },
    intent: { title: "What do they need?", config: { options: [] } },
    data_pull: { title: "Look it up", config: { tool: "lookup_order" } },
    branch: { title: "Decide", config: {} },
    say: { title: "Say", config: { script: "" } },
    collect: { title: "Collect details", config: { fields: ["name", "phone"] } },
    book: { title: "Book a slot", config: {} },
    escalate: { title: "Transfer to human", config: {} },
    handoff: { title: "Hand off", config: {} },
    end: { title: "Close and hang up", config: { hangUp: true } },
  };
  const d = defaults[kind];
  return { id, kind, title: d.title ?? kind, x, y, config: d.config };
}
