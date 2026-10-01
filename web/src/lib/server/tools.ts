import "server-only";
import { getDb } from "./db";
import { ingestKnowledgeDoc, searchKnowledge } from "./ai";
import { agents as listAgents, createBooking, updateAgent } from "./repo";
import { agentSummary } from "./live-prompt";
import { NODE_KIND_LABEL } from "@/lib/agents/flow";
import { VOICE_CATALOG, voiceByName } from "@/lib/live/voices";
import { guessGender } from "@/lib/agents/role";
import { notifyTicket, lookupTickets, registerTicket, resolveTicket } from "./tickets";
import {
  appointmentTypes,
  logToolInvocation,
  playbook,
  setupStatus,
  transferTargets,
  upsertAppointmentType,
  upsertDepartment,
  upsertPlaybook,
  upsertTransfer,
} from "./workspace";
import { planAgents } from "./planner";

/**
 * The agent's hands.
 *
 * The function *declarations* live in `lib/live/config.ts` (shared config,
 * baked into the ephemeral token's constraints so the model knows the tools
 * exist). Execution always happens here, on the server, against our database
 * or the tenant's connector. The browser only ferries the call — a tool that
 * executed client-side would let anyone with devtools register complaints as
 * arbitrary customers.
 *
 * These four cover the demo narratives end to end: an order enquiry pulls real
 * data, a grievance produces a reference number and lands in the right
 * department's queue while the caller is still on the line, a booking lands on
 * the calendar, and policy questions search the knowledge base.
 */

/** Everything a tool returns is spoken aloud by the model, so results are
 *  small, flat objects with plain-language values — not API payloads. */
export async function executeTool(
  orgId: string,
  callId: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await runTool(orgId, callId, name, args);
  try {
    logToolInvocation(orgId, callId, name, args, result);
  } catch (error) {
    console.error("[tools] invocation log failed:", error);
  }
  return result;
}

async function runTool(
  orgId: string,
  callId: string | null,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "lookup_order":
      return lookupOrder(orgId, args);
    case "register_complaint":
      return registerComplaint(orgId, callId, args);
    case "lookup_ticket":
      return lookupTicketTool(orgId, callId, args);
    case "notify_stakeholder":
      return notifyTicketTool(orgId, callId, args);
    case "resolve_ticket":
      return resolveTicketTool(orgId, args);
    case "book_slot":
      return bookSlot(orgId, args);
    case "search_knowledge": {
      const agentId = callId
        ? (getDb().prepare("SELECT agent_id FROM calls WHERE id=? AND org_id=?").get(callId, orgId) as { agent_id: string } | undefined)?.agent_id
        : undefined;
      const results = await searchKnowledge(orgId, String(args.query ?? ""), 4, agentId);
      return results.length
        ? { found: true, results: results.map((r) => ({ source: r.doc, text: r.content.slice(0, 500) })) }
        : { found: false, note: "Nothing in this agent's knowledge. Say you don't have this detail. Do not guess, and do not use another team's policy." };
    }
    case "transfer_to_human":
      return transferHuman(orgId, args);
    case "handoff_to_agent":
      return handoffToAgent(orgId, callId, args);
    case "end_call":
      return endCall(orgId, callId, args);

    // Swara's setup tools. Each writes a workspace row and returns what was
    // saved, so she can confirm it in half a sentence.
    case "get_setup_status": {
      const s = setupStatus(orgId);
      const d = getDb();
      return {
        business: s.playbook.businessType || "not described yet",
        use_case: String(s.playbook.extra.useCase ?? "not set"),
        hours: s.playbook.hours,
        departments: (d.prepare("SELECT name FROM departments WHERE org_id=?").all(orgId) as { name: string }[]).map((r) => r.name),
        transfer_desks: transferTargets(orgId).map((t) => `${t.name} (${t.role})`),
        appointment_types: appointmentTypes(orgId).map((a) => a.name),
        knowledge_docs: s.knowledge,
        agents: (d.prepare("SELECT name FROM agents WHERE org_id=?").all(orgId) as { name: string }[]).map((r) => r.name),
      };
    }
    case "save_playbook": {
      const p = upsertPlaybook(orgId, {
        businessType: str(args.business_type),
        hours: str(args.hours),
        transferPolicy: str(args.transfer_policy),
        bookingPolicy: str(args.booking_policy),
        complaintSlaHours: typeof args.complaint_sla_hours === "number" ? Math.round(args.complaint_sla_hours) : undefined,
        useCase: str(args.use_case),
        hasSales: typeof args.has_sales === "boolean" ? args.has_sales : undefined,
        humanEscalation: typeof args.human_escalation === "boolean" ? args.human_escalation : undefined,
      });
      return { saved: true, business: p.businessType, use_case: p.extra.useCase ?? "other", hours: p.hours };
    }
    case "add_department": {
      const name = str(args.name);
      if (!name) return { error: "Department needs a name." };
      const r = upsertDepartment(orgId, { name, keywords: strList(args.keywords) });
      return { saved: true, department: name, id: r.id };
    }
    case "add_transfer_target": {
      const phone = str(args.phone)?.replace(/[^\d+]/g, "") ?? "";
      if (phone.replace(/\D/g, "").length < 10) return { error: "That number is too short. Ask for the full 10-digit mobile and read it back." };
      const deptName = str(args.department)?.toLowerCase();
      const dept = deptName
        ? (getDb().prepare("SELECT id FROM departments WHERE org_id=? AND lower(name)=?").get(orgId, deptName) as { id: string } | undefined)
        : undefined;
      const r = upsertTransfer(orgId, {
        name: str(args.name) ?? "On-call",
        role: str(args.role) ?? "Escalation",
        phone: phone.startsWith("+") ? phone : phone.length === 10 ? `+91${phone}` : `+${phone}`,
        hours: str(args.hours),
        whenToUse: str(args.when_to_use) ?? "Caller asked for a person, or the agent is stuck",
        departmentId: dept?.id ?? null,
      });
      return { saved: true, desk: args.name, id: r.id, note: "Agents may now transfer to this person." };
    }
    case "add_appointment_type": {
      const name = str(args.name);
      if (!name) return { error: "Appointment type needs a name." };
      const r = upsertAppointmentType(orgId, {
        name,
        durationMin: typeof args.duration_min === "number" ? Math.round(args.duration_min) : 30,
        hours: str(args.hours),
        location: str(args.location),
        notes: str(args.notes),
      });
      return { saved: true, appointment_type: name, id: r.id };
    }
    case "add_knowledge": {
      const name = str(args.name);
      const text = str(args.text);
      if (!name || !text || text.length < 20) return { error: "Need a name and at least a full sentence of text." };
      const doc = await ingestKnowledgeDoc(orgId, name, "text", text, agentIdFor(orgId, str(args.agent_name)));
      return { saved: true, document: name, chunks: doc.chunks, note: "Only the agent this was filed under will search it." };
    }
    case "propose_agents": {
      const brief = str(args.brief) ?? "";
      const proposed = Array.isArray(args.agents) ? (args.agents as Record<string, unknown>[]) : [];
      try {
        const plan = await planAgents(orgId, {
          brief: [
            brief,
            proposed.length
              ? `Swara proposes: ${proposed
                  .map((a) => {
                    const bits = [`${a.name} (${a.direction}, ${a.intent}): ${a.job}`];
                    if (str(a.persona_name)) bits.push(`introduces itself as ${str(a.persona_name)}`);
                    if (str(a.voice)) bits.push(`voice ${str(a.voice)}`);
                    return bits.join("; ");
                  })
                  .join(" | ")}`
              : "",
          ].filter(Boolean).join("\n"),
        });
        // The plan is handed to the console through the tool result. The
        // browser session surfaces it in the Build-with-Swara panel for
        // approval; nothing is created until the owner says so.
        return {
          proposed: true,
          agents: plan.agents.map((a) => `${a.name} — ${a.direction}`),
          gaps: plan.gaps,
          note: "The console is showing this plan for approval. Describe it in three sentences and ask if anything should change.",
          __plan: plan,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Planning failed",
          note: "Do not invent a replacement set of agents. Tell the owner the model failed and to retry. Leave the workspace as it is.",
        };
      }
    }
    case "list_agents":
      return {
        agents: listAgents(orgId).map((a) => ({
          id: a.id,
          name: a.name,
          job: agentSummary(a.prompt ?? null, a.intent),
          status: a.status,
          direction: a.direction,
          introduces_itself_as: a.personaName ?? null,
          voice: a.voice ?? null,
          tools: a.tools,
        })),
      };
    case "get_agent": {
      const agent = findAgent(orgId, str(args.agent));
      if (!agent) return { error: `No agent called ${str(args.agent) ?? "that"}. Use list_agents for the exact names.` };
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        direction: agent.direction,
        intent: agent.intent,
        introduces_itself_as: agent.personaName ?? null,
        voice: agent.voice ?? null,
        tools: agent.tools,
        role: agent.prompt ?? "",
        flow_steps: (agent.nodes as { kind: keyof typeof NODE_KIND_LABEL; title: string }[]).map(
          (n) => `${NODE_KIND_LABEL[n.kind] ?? n.kind}: ${n.title}`,
        ),
      };
    }
    case "update_agent":
      return updateAgentTool(orgId, args);
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/* ── Editing existing agents (Swara) ─────────────────────────────────────── */

function findAgent(orgId: string, ref: string | undefined) {
  if (!ref) return undefined;
  const q = ref.trim().toLowerCase();
  const all = listAgents(orgId);
  return (
    all.find((a) => a.id === ref.trim()) ??
    all.find((a) => a.name.toLowerCase() === q) ??
    all.find((a) => a.name.toLowerCase().includes(q) || (a.personaName ?? "").toLowerCase() === q)
  );
}

const CALL_TOOL_NAMES = new Set([
  "lookup_order", "register_complaint", "lookup_ticket", "notify_stakeholder", "resolve_ticket",
  "book_slot", "search_knowledge", "transfer_to_human", "handoff_to_agent", "end_call",
]);

/**
 * Applies a change Swara agreed with the owner. Every edit is a new version
 * (repo.updateAgent bumps it), so Versions shows exactly what she changed.
 */
function updateAgentTool(orgId: string, args: Record<string, unknown>): Record<string, unknown> {
  const agent = findAgent(orgId, str(args.agent));
  if (!agent) return { error: `No agent called ${str(args.agent) ?? "that"}. Use list_agents for the exact names.` };

  const changed: string[] = [];
  const patch: Parameters<typeof updateAgent>[2] = {};

  const name = str(args.name)?.trim();
  if (name && name !== agent.name) {
    patch.name = name.slice(0, 60);
    changed.push(`name → ${patch.name}`);
  }
  const role = str(args.role)?.trim();
  if (role && role !== agent.prompt) {
    if (role.length < 40) return { error: "That role is too short to run a call on. Send the complete role text." };
    patch.prompt = role.slice(0, 6000);
    changed.push("role rewritten");
  }
  const persona = str(args.persona_name)?.trim();
  if (persona && persona !== agent.personaName) {
    patch.personaName = persona.split(/\s+/)[0].slice(0, 40);
    changed.push(`introduces itself as ${patch.personaName}`);
  }
  const voiceArg = str(args.voice)?.trim();
  if (voiceArg) {
    const match = VOICE_CATALOG.find((v) => v.name.toLowerCase() === voiceArg.toLowerCase());
    if (!match) return { error: `No voice called ${voiceArg}. Voices: ${VOICE_CATALOG.map((v) => v.name).join(", ")}.` };
    const personaGender = guessGender(patch.personaName ?? agent.personaName);
    if (personaGender && personaGender !== match.gender) {
      return {
        error: `${match.name} is a ${match.gender} voice but the agent introduces itself as ${patch.personaName ?? agent.personaName}. Pick a ${personaGender} voice (e.g. ${VOICE_CATALOG.filter((v) => v.gender === personaGender).slice(0, 4).map((v) => v.name).join(", ")}) or change the name too.`,
      };
    }
    if (match.name !== agent.voice) {
      patch.voice = match.name;
      changed.push(`voice → ${match.name} (${voiceByName(match.name).descriptor})`);
    }
  }
  const direction = str(args.direction);
  if (direction && ["inbound", "outbound", "both"].includes(direction) && direction !== agent.direction) {
    patch.direction = direction;
    changed.push(`direction → ${direction}`);
  }
  const status = str(args.status);
  if (status && ["draft", "testing", "live", "paused"].includes(status) && status !== agent.status) {
    patch.status = status;
    changed.push(`status → ${status}`);
  }
  const add = Array.isArray(args.add_tools) ? (args.add_tools as unknown[]).map(String) : [];
  const remove = Array.isArray(args.remove_tools) ? (args.remove_tools as unknown[]).map(String) : [];
  if (add.length || remove.length) {
    const unknown = [...add, ...remove].filter((t) => !CALL_TOOL_NAMES.has(t));
    if (unknown.length) return { error: `Unknown tools: ${unknown.join(", ")}. Available: ${[...CALL_TOOL_NAMES].join(", ")}.` };
    const next = new Set(agent.tools.length ? agent.tools : ["end_call"]);
    for (const t of add) next.add(t);
    for (const t of remove) if (t !== "end_call") next.delete(t);
    patch.tools = [...next];
    changed.push(`tools → ${patch.tools.join(", ")}`);
  }

  if (changed.length === 0) return { changed: false, note: "Nothing in that request differs from what the agent already has." };
  const res = updateAgent(orgId, agent.id, patch);
  if (res.error) return { error: res.error };
  return {
    changed: true,
    agent: patch.name ?? agent.name,
    changes: changed,
    note: "Saved as a new version; it applies from the next call. Tell the owner what changed in one line.",
  };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strList = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : undefined);

function agentIdFor(orgId: string, name: string | undefined) {
  if (!name) return null;
  const row = getDb()
    .prepare("SELECT id FROM agents WHERE org_id=? AND lower(name)=lower(?)")
    .get(orgId, name) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Handoff to a sibling agent. The tool result carries a control record the
 * session runtime acts on: it swaps the persona underneath the same call and
 * feeds the summary in as a [HANDOFF: ...] marker. The model only sees a
 * confirmation, so it says its one-line bridge and stops talking.
 */
function handoffToAgent(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const asked = String(args.agent_name ?? "").toLowerCase().trim();
  const rows = getDb()
    .prepare("SELECT id, name, intent FROM agents WHERE org_id=?")
    .all(orgId) as { id: string; name: string; intent: string }[];
  const target =
    rows.find((r) => r.name.toLowerCase() === asked) ??
    rows.find((r) => asked && (r.name.toLowerCase().includes(asked) || asked.includes(r.name.toLowerCase())));
  if (!target) {
    return {
      error: `No agent called "${args.agent_name}". Only hand off to a name in your AGENT DIRECTORY. Otherwise handle it yourself or take a callback.`,
    };
  }
  if (callId) {
    getDb().prepare("UPDATE calls SET agent_id=?, agent_name=?, intent=? WHERE id=? AND org_id=?")
      .run(target.id, target.name, target.intent, callId, orgId);
  }
  return {
    handed_off: true,
    to: target.name,
    note: "Stop speaking now. The other agent continues the call.",
    __control: { kind: "handoff", agentId: target.id, agentName: target.name, summary: String(args.summary ?? "") },
  };
}

/** Mark the call outcome; the runtime hangs up once the closing audio drains. */
function endCall(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const outcome = String(args.outcome ?? "resolved");
  if (callId) {
    getDb().prepare("UPDATE calls SET outcome=? WHERE id=? AND org_id=? AND outcome IS NULL")
      .run(outcome === "escalated" ? "escalated" : outcome === "no_answer" ? "no_answer" : "resolved", callId, orgId);
  }
  return { ending: true, note: "Say nothing further.", __control: { kind: "end", outcome } };
}

/**
 * Order lookup, via whichever connector the tenant configured.
 *
 * `rest`: we call their endpoint with their credential. This is the honest
 * answer to "how do we connect to their database": we don't — they expose a
 * read endpoint and we call it per enquiry. See docs/backend.md for why direct
 * DB credentials were rejected.
 *
 * `demo`: deterministic synthetic orders so the demo org works with no setup.
 */
async function lookupOrder(orgId: string, args: Record<string, unknown>) {
  const connector = getDb()
    .prepare("SELECT * FROM connectors WHERE org_id=? AND tool='lookup_order' AND status='connected'")
    .get(orgId) as
    | { kind: string; base_url: string | null; auth_header: string | null; auth_secret: string | null }
    | undefined;

  if (!connector) {
    return { error: "No order system connected. Apologise and offer a callback after checking manually." };
  }

  const orderId = String(args.order_id ?? "").trim();
  const phone = String(args.phone ?? "").trim();

  if (connector.kind === "rest" && connector.base_url) {
    try {
      const url = new URL(connector.base_url);
      if (orderId) url.searchParams.set("order_id", orderId);
      if (phone) url.searchParams.set("phone", phone);
      const response = await fetch(url, {
        headers: connector.auth_header && connector.auth_secret
          ? { [connector.auth_header]: connector.auth_secret }
          : undefined,
        // A slow tenant API is dead air on a live call. Better to time out and
        // have the agent offer an SMS follow-up than to hold silence.
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return { error: `Order system returned ${response.status}. Offer a callback.` };
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return { error: "Order system is not responding. Offer to confirm by SMS after checking." };
    }
  }

  // Demo connector: stable fake orders keyed by the digits given, so repeating
  // the same ID mid-call returns the same answer.
  const key = orderId || phone;
  if (!key) return { error: "Need an order ID or registered phone number." };
  const digits = key.replace(/\D/g, "") || "0";
  const h = [...digits].reduce((a, c) => (a * 31 + Number(c)) % 997, 7);
  const statuses = [
    { status: "out for delivery", eta: "today between 4pm and 7pm" },
    { status: "shipped", eta: "tomorrow by 8pm" },
    { status: "packed at warehouse", eta: "in 2-3 days" },
    { status: "delivered", eta: "already delivered yesterday at 2:41pm" },
    { status: "delayed at hub", eta: "revised to day after tomorrow; delay SMS already sent" },
  ];
  const s = statuses[h % statuses.length];
  return {
    order_id: orderId || `ORD-${digits.slice(-5).padStart(5, "0")}`,
    status: s.status,
    expected: s.eta,
    amount_inr: 499 + (h % 35) * 100,
    payment: h % 3 === 0 ? "cash on delivery" : "prepaid",
    items: 1 + (h % 3),
  };
}

/** The number the caller is on, so tools never depend on the model re-asking for it. */
function callPhone(orgId: string, callId: string | null) {
  if (!callId) return undefined;
  const row = getDb().prepare("SELECT phone FROM calls WHERE id=? AND org_id=?").get(callId, orgId) as { phone: string } | undefined;
  const p = row?.phone?.trim();
  return p && p !== "unknown" && p.replace(/\D/g, "").length >= 10 ? p : undefined;
}

const STOP = new Set(["the", "a", "an", "at", "in", "on", "of", "for", "to", "and", "is", "not", "no", "with", "about", "station", "metro", "complaint", "issue", "problem"]);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Same caller, still open, same category or clearly the same words → likely the same complaint. */
function similarOpenTickets(orgId: string, phone: string | undefined, title: string, category: string) {
  if (!phone) return [];
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const mine = lookupTickets(orgId, { phone }).filter((t) => t.stage !== "resolved" && t.openedAt >= since);
  const mineWords = words(title);
  return mine.filter((t) => {
    if (t.category.toLowerCase() === category.toLowerCase() && category.toLowerCase() !== "other") return true;
    const shared = [...words(t.title)].filter((w) => mineWords.has(w)).length;
    return shared >= 2 || (shared >= 1 && mineWords.size <= 3);
  });
}

async function registerComplaint(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const phone = str(args.phone) ?? callPhone(orgId, callId) ?? "";
  const title = String(args.title ?? "");
  const category = String(args.category ?? "other");

  // A second ticket for the same thing helps nobody: the desk works it twice
  // and the caller gets two numbers. Surface the existing one and let the
  // agent ask; a genuinely new issue goes through with confirm_new.
  if (args.confirm_new !== true) {
    const dupes = similarOpenTickets(orgId, phone, title, category);
    if (dupes.length) {
      return {
        registered: false,
        possible_duplicate: true,
        existing: dupes.slice(0, 3).map((t) => ({
          reference_number: t.ref,
          title: t.title,
          stage: t.stage.replace("_", " "),
          opened_at: t.openedAt,
          department: t.department,
        })),
        note:
          `This caller already has an open ${dupes[0].kind} ${dupes[0].ref} about "${dupes[0].title}" (${dupes[0].stage.replace("_", " ")}). ` +
          "Tell them you can see it and where it stands, and ask if this is the same issue. If it is the same, do NOT file again — offer to notify the desk (notify_stakeholder) and give them the existing reference. " +
          "Only if they say it is a different problem, call register_complaint again with confirm_new: true.",
      };
    }
  }

  const filed = await registerTicket(orgId, callId, { ...args, phone });
  return {
    registered: true,
    reference_number: filed.ref,
    kind: filed.kind,
    routed_to: filed.routed_to,
    sla: "48 business hours",
    note: "Read the reference number back digit by digit, once. The caller can quote this number, or just call from this phone, to check status later.",
  };
}

function lookupTicketTool(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const reference = str(args.reference_number) ?? str(args.reference);
  const phone = str(args.phone) ?? (reference ? undefined : callPhone(orgId, callId));
  let hits = lookupTickets(orgId, {
    reference,
    customerName: str(args.customer_name),
    phone,
  });
  // A wrong-by-one reference or a misheard name should not dead-end the
  // caller when the phone they are on identifies them.
  if (!hits.length) {
    const byPhone = callPhone(orgId, callId);
    if (byPhone) hits = lookupTickets(orgId, { phone: byPhone });
  }
  if (!hits.length) {
    return {
      found: false,
      note: "No ticket for this caller — not by that reference, and none filed from the number they are calling from. Say so plainly; do not suggest their complaint is 'still updating'. Offer to file it now.",
    };
  }
  const t = hits[0];
  const stageWord = t.stage === "resolved" ? "closed — marked done" : t.stage === "in_progress" ? "in progress — the desk is working on it" : t.stage === "escalated" ? "escalated" : "open — filed, waiting to be picked up";
  return {
    found: true,
    reference_number: t.ref,
    kind: t.kind,
    title: t.title,
    stage: t.stage,
    status_in_words: stageWord,
    customer_name: t.customerName,
    department: t.department,
    opened_at: t.openedAt,
    matches: hits.length,
    others: hits.slice(1, 4).map((o) => ({ reference_number: o.ref, title: o.title, stage: o.stage })),
    note:
      t.stage === "resolved"
        ? "This ticket is already marked done. Tell the caller that and ask if a new issue came up."
        : `Routed to ${t.department ?? "the team"}. Status: ${stageWord}.${hits.length > 1 ? ` They have ${hits.length} tickets — ask which one they mean if unclear.` : ""}`,
  };
}

async function notifyTicketTool(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const channelRaw = String(args.channel ?? "call").toLowerCase();
  const channel =
    channelRaw === "email" || channelRaw === "whatsapp" || channelRaw === "sms" || channelRaw === "call"
      ? channelRaw
      : "call";
  return notifyTicket(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    channel,
    targetName: str(args.target_name) ?? str(args.department),
    message: str(args.message),
    callId,
  });
}

function resolveTicketTool(orgId: string, args: Record<string, unknown>) {
  return resolveTicket(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    note: str(args.note),
    closedBy: str(args.closed_by) ?? "agent",
  });
}

async function bookSlot(orgId: string, args: Record<string, unknown>) {
  const date = String(args.date ?? "");
  const window = String(args.time_window ?? "");
  const typeName = String(args.type ?? "Appointment");
  const types = appointmentTypes(orgId);
  const match = types.find((t) => t.name.toLowerCase() === typeName.toLowerCase()) ?? types[0];
  if (types.length && !types.some((t) => t.name.toLowerCase() === typeName.toLowerCase())) {
    return {
      error: `That type is not offered. Available: ${types.map((t) => t.name).join(", ")}. Offer one of those.`,
    };
  }

  const startHour = window.match(/^(\d{1,2})/)?.[1] ?? "10";
  const startsAt = new Date(`${date}T${startHour.padStart(2, "0")}:00:00+05:30`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Could not parse the date. Confirm the exact date with the caller." };
  }

  createBooking({
    orgId,
    customerName: String(args.customer_name ?? "Unknown"),
    phone: String(args.phone ?? ""),
    type: match?.name ?? typeName,
    startsAt: startsAt.toISOString(),
    durationMin: match?.durationMin ?? 60,
    source: "call",
  });

  return {
    booked: true,
    date,
    time_window: window,
    note: "Read the slot back and mention the SMS confirmation.",
  };
}

function transferHuman(orgId: string, args: Record<string, unknown>) {
  if (playbook(orgId).extra.humanEscalation === false) {
    return {
      error: "The owner said there is no human to transfer to. Say that, take a name and callback number, and do not offer a transfer.",
    };
  }
  const targets = transferTargets(orgId);
  if (targets.length === 0) {
    return {
      error: "No transfer desk is configured. Take a callback number and say someone will call them back. Do not invent a person.",
    };
  }
  const asked = String(args.target_name ?? "").toLowerCase();
  const target =
    (asked && targets.find((t) => t.name.toLowerCase().includes(asked) || t.role.toLowerCase().includes(asked))) ||
    targets[0];
  return {
    transferred: true,
    to: target.name,
    role: target.role,
    phone: target.phone,
    hours: target.hours,
    reason: String(args.reason ?? ""),
    note: `Tell the caller you are connecting them to ${target.name}, ${target.role}. Do not read the full number unless they ask.`,
    // On a phone leg the bridge dials this number and drops out; in the
    // browser test bench it is shown as a caption.
    __control: { kind: "transfer", phone: target.phone, name: target.name },
  };
}
