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
  /** escalate: which person to connect to (by name). Empty = the best match. */
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
  escalate: "Connect the caller to a person who takes calls, via transfer_to_human.",
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
  ctx: {
    /** Names of the people who take calls. */
    transfers: string[];
    appointmentTypes: string[];
    agents: { id: string; name: string }[];
    /**
     * False when this agent is set to inform a person after the call (or to
     * handle it alone): a Transfer step then takes the caller's details
     * instead of connecting them, so an empty people list is not an error.
     */
    liveTransfer?: boolean;
  },
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
    if (n.kind === "escalate" && ctx.liveTransfer === false) {
      issues.push({
        level: "warn",
        nodeId: n.id,
        message: `"${n.title}" will take the caller's details instead of connecting them — this agent is not set to connect callers live (Agent role → When a call needs a person).`,
      });
    } else if (n.kind === "escalate" && ctx.transfers.length === 0) {
      issues.push({ level: "error", nodeId: n.id, message: "Transfer step, but nobody in Workspace setup takes calls. Add a person and tick Calls, or set this agent to inform a person after the call." });
    } else if (n.kind === "escalate" && cfg.transferTarget && !ctx.transfers.includes(cfg.transferTarget)) {
      issues.push({ level: "warn", nodeId: n.id, message: `"${cfg.transferTarget}" is no longer listed, or no longer takes calls.` });
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
  ctx: {
    agents: { id: string; name: string }[];
    allowTransfer?: boolean;
    /** No live transfer, but the right person is told when the call ends. */
    informAfter?: boolean;
    concise?: boolean;
  },
): string {
  if (nodes.length === 0) return "";
  const start = nodes.find((n) => n.kind === "start") ?? nodes[0];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // What a transfer step means on a call where nobody can be connected.
  const noTransfer = ctx.informAfter
    ? "you cannot connect them to a person on this call — take down what they need and tell them the right person will be informed and will get back to them"
    : "no human is available for live transfer — let them know warmly and take a callback";

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

  // When the agent already has a tailored role prompt, only surface custom
  // scripts, notes, and specific branch/handoff/transfer wiring from the
  // canvas so we do not feed the voice model a second mechanical checklist.
  if (ctx.concise) {
    const hints: string[] = [];
    for (const n of order) {
      const cfg = nodeConfig(n);
      const outs = outgoing(edges, n.id);
      if (n.kind === "start" && cfg.script) {
        hints.push(`- Opening line: "${cfg.script}"`);
      } else if (n.kind === "say" && cfg.script) {
        hints.push(`- At "${n.title}", say: "${cfg.script}"`);
      } else if ((n.kind === "intent" || n.kind === "branch") && outs.length > 1) {
        const opts = outs
          .map((e) => `${e.label || byId.get(e.to)?.title || "otherwise"} → ${byId.get(e.to)?.title ?? "next"}`)
          .join("; ");
        hints.push(`- ${n.title}: ${opts}.${cfg.note ? ` ${cfg.note}` : ""}`);
      } else if (n.kind === "book" && cfg.appointmentType) {
        hints.push(`- Booking type: "${cfg.appointmentType}".${cfg.note ? ` ${cfg.note}` : ""}`);
      } else if (n.kind === "escalate" && ctx.allowTransfer !== false && cfg.transferTarget) {
        hints.push(`- Human transfer desk for "${n.title}": ${cfg.transferTarget}.${cfg.note ? ` ${cfg.note}` : ""}`);
      } else if (n.kind === "escalate" && ctx.allowTransfer === false) {
        // The branch hints above may still point at this step by its title.
        hints.push(`- "${n.title}": ${noTransfer}.`);
      } else if (n.kind === "handoff") {
        const target = ctx.agents.find((a) => a.id === cfg.agentId);
        if (target) hints.push(`- Hand off to ${target.name} when the caller needs ${n.title.replace(/^Hand off\s*→?\s*/i, "")}.`);
      } else if (n.kind === "end" && cfg.script) {
        hints.push(`- Closing line: "${cfg.script}"`);
      } else if (cfg.note) {
        hints.push(`- ${n.title}: ${cfg.note}`);
      }
    }
    return hints.length
      ? ["FLOW NOTES (follow naturally; never read node names aloud):", ...hints].join("\n")
      : "";
  }

  const ref = (id: string) => {
    const n = byId.get(id);
    return n ? `"${n.title}"` : "the next step";
  };

  const lines: string[] = [
    "CALL FLOW — follow this sequence naturally in conversation; skip anything the caller already answered, and never read step titles aloud:",
  ];

  for (const n of order) {
    const cfg = nodeConfig(n);
    const outs = outgoing(edges, n.id);
    const next = outs.length === 1 ? ` Then move to ${ref(outs[0].to)}.` : "";
    const note = cfg.note ? ` ${cfg.note}` : "";
    const head = `- ${n.title}`;

    switch (n.kind) {
      case "start":
        lines.push(`${head}: greet naturally with your name and business, then listen.${cfg.script ? ` Opening: "${cfg.script}"` : ""}${next}${note}`);
        break;
      case "say":
        lines.push(`${head}: ${cfg.script ? `say "${cfg.script}"` : "share this briefly"}.${next}${note}`);
        break;
      case "collect": {
        const fields = cfg.fields?.length ? cfg.fields.join(", ") : n.detail || "the needed details";
        lines.push(`${head}: gather ${fields} naturally if not already known.${next}${note}`);
        break;
      }
      case "intent":
      case "branch": {
        if (outs.length === 0) {
          lines.push(`${head}: ${n.detail || "understand what the caller needs"}.${note}`);
        } else {
          const opts = outs
            .map((e) => `if ${e.label || byId.get(e.to)?.title || "so"} → ${ref(e.to)}`)
            .join("; ");
          lines.push(`${head}: ${opts}.${note}`);
        }
        break;
      }
      case "data_pull":
        lines.push(`${head}: look up the information before answering.${next}${note}`);
        break;
      case "book":
        lines.push(`${head}: offer two concrete slots${cfg.appointmentType ? ` for "${cfg.appointmentType}"` : ""} and confirm date, time, and location before booking.${next}${note}`);
        break;
      case "escalate":
        if (ctx.allowTransfer === false) {
          lines.push(`${head}: ${noTransfer}.${note}`);
          break;
        }
        lines.push(`${head}: let the caller know you are connecting them${cfg.transferTarget ? ` to ${cfg.transferTarget}` : " to a colleague"} and transfer the call.${note}`);
        break;
      case "handoff": {
        const target = ctx.agents.find((a) => a.id === cfg.agentId);
        lines.push(`${head}: let the caller know in one short sentence that you are connecting them to ${target?.name ?? "the right team"}, then hand off the call.${note}`);
        break;
      }
      case "end":
        lines.push(
          cfg.script
            ? `${head}: say "${cfg.script}" and end the call.${note}`
            : `${head}: check if they need anything else; once they are done, say a warm goodbye and end the call.${note}`,
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
