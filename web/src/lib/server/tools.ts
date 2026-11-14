import "server-only";
import { getDb } from "./db";
import { ingestKnowledgeDoc, searchKnowledge } from "./ai";
import { agents as listAgents, createBooking, updateAgent } from "./repo";
import { agentSummary } from "./live-prompt";
import { NODE_KIND_LABEL } from "@/lib/agents/flow";
import { VOICE_CATALOG, voiceByName } from "@/lib/live/voices";
import { guessGender } from "@/lib/agents/role";
import {
  addTicketMessage,
  lookupTickets,
  matchStaffContact,
  notifyTicket,
  registerTicket,
  resolveTicket,
  ticketsForStaff,
  updateComplaintStage,
  updateTicket,
} from "./tickets";
import {
  appointmentTypes,
  deleteAppointmentType,
  deleteDepartment,
  deleteTransfer,
  findAppointmentType,
  findPerson,
  findTeam,
  liveTransferPeople,
  logToolInvocation,
  playbook,
  publicPlaybook,
  setupStatus,
  teams,
  transferTargets,
  upsertAppointmentType,
  upsertDepartment,
  upsertPlaybook,
  upsertTransfer,
  type Person,
} from "./workspace";
import { planAgents } from "./planner";
import { HUMAN_MODES, HUMAN_MODE_SHORT, canConnectLive, normaliseHumanMode, type HumanMode } from "@/lib/agents/human-mode";

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
    case "update_ticket":
      return updateTicketTool(orgId, callId, args);
    case "resolve_ticket":
      return resolveTicketTool(orgId, callId, args);
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
      return transferHuman(orgId, callId, args);
    case "handoff_to_agent":
      return handoffToAgent(orgId, callId, args);
    case "end_call":
      return endCall(orgId, callId, args);

    // Swara's setup tools. Each writes a workspace row and returns what was
    // saved, so she can confirm it in half a sentence.
    case "get_setup_status":
      return setupSnapshot(orgId);
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
        features: {
          ...(typeof args.takes_complaints === "boolean" ? { complaints: args.takes_complaints } : {}),
          ...(typeof args.takes_appointments === "boolean" ? { appointments: args.takes_appointments } : {}),
          ...(typeof args.looks_up_orders === "boolean" ? { orders: args.looks_up_orders } : {}),
        },
      });
      return { saved: true, business: p.businessType, use_case: p.extra.useCase ?? "other", hours: p.hours };
    }
    case "add_department": {
      const name = str(args.name);
      if (!name) return { error: "A team needs a name." };
      const r = upsertDepartment(orgId, { name, keywords: strList(args.keywords), email: str(args.email) });
      return { saved: true, department: name, id: r.id };
    }
    case "update_department": {
      const team = findTeam(orgId, str(args.department));
      if (!team) return { error: `No team called ${str(args.department) ?? "that"}. Teams: ${teams(orgId).map((t) => t.name).join(", ") || "none"}.` };
      const name = str(args.name) ?? team.name;
      upsertDepartment(orgId, {
        id: team.id,
        name,
        keywords: strList(args.keywords) ?? team.keywords,
        email: typeof args.email === "string" ? args.email.trim() : team.email,
        phone: team.phone,
        whatsapp: team.whatsapp,
      });
      return { saved: true, department: name, note: "Tell the owner what changed in one line." };
    }
    case "remove_department": {
      const team = findTeam(orgId, str(args.department));
      if (!team) return { error: `No team called ${str(args.department) ?? "that"}. Teams: ${teams(orgId).map((t) => t.name).join(", ") || "none"}.` };
      if (args.confirmed !== true) {
        return { removed: false, note: `Ask the owner to confirm removing the ${team.name} team first. Its open work would move to the Unassigned queue; its people stay.` };
      }
      const res = deleteDepartment(orgId, team.id);
      if (res.error) return { error: res.error };
      return {
        removed: true,
        department: team.name,
        note: res.movedTo ? `Its tickets and follow-ups moved to ${res.movedTo}${res.openMoved ? ` (${res.openMoved} still open)` : ""}.` : "It owned no work.",
      };
    }
    case "add_transfer_target": {
      const name = str(args.name);
      if (!name) return { error: "A person needs a name." };
      if (findPerson(orgId, name)?.name.toLowerCase() === name.toLowerCase()) {
        return { error: `${name} is already listed. Use update_person to change their details.` };
      }
      const dept = teamByName(orgId, str(args.department));
      if (dept === null) return { error: `No team called ${str(args.department)}. Add the team first, or leave the team out.` };
      const r = upsertTransfer(orgId, {
        name,
        role: str(args.role),
        phone: str(args.phone),
        email: str(args.email),
        contactCalls: bool(args.takes_calls),
        contactEmail: bool(args.takes_email),
        isDefault: bool(args.is_default),
        hours: str(args.hours),
        whenToUse: str(args.when_to_use),
        departmentId: dept?.id ?? null,
      });
      if (r.error) return { error: r.error };
      const saved = findPerson(orgId, r.id);
      return { saved: true, person: saved ? personLine(saved) : name, note: reachNote(saved) };
    }
    case "update_person": {
      const person = findPerson(orgId, str(args.person));
      if (!person) return { error: `Nobody called ${str(args.person) ?? "that"} is listed. People: ${transferTargets(orgId).map((p) => p.name).join(", ") || "none"}.` };
      const dept = typeof args.department === "string" ? (args.department.trim() ? teamByName(orgId, args.department) : undefined) : { id: person.departmentId };
      if (dept === null) return { error: `No team called ${str(args.department)}. Add the team first.` };
      const phone = str(args.phone) ?? person.phone;
      const email = str(args.email) ?? person.email;
      const r = upsertTransfer(orgId, {
        id: person.id,
        name: str(args.name) ?? person.name,
        role: str(args.role) ?? person.role,
        phone,
        email,
        whatsapp: person.whatsapp,
        // Giving a number or an address for the first time switches that
        // channel on, unless the owner said otherwise.
        contactCalls: bool(args.takes_calls) ?? (person.contactCalls || (Boolean(str(args.phone)) && !person.phone)),
        contactEmail: bool(args.takes_email) ?? (person.contactEmail || (Boolean(str(args.email)) && !person.email)),
        isDefault: bool(args.is_default),
        hours: str(args.hours) ?? person.hours,
        whenToUse: str(args.when_to_use) ?? person.whenToUse,
        departmentId: dept?.id ?? null,
      });
      if (r.error) return { error: r.error };
      const saved = findPerson(orgId, person.id);
      return { saved: true, person: saved ? personLine(saved) : person.name, note: reachNote(saved) };
    }
    case "remove_person": {
      const person = findPerson(orgId, str(args.person));
      if (!person) return { error: `Nobody called ${str(args.person) ?? "that"} is listed. People: ${transferTargets(orgId).map((p) => p.name).join(", ") || "none"}.` };
      if (args.confirmed !== true) {
        return { removed: false, note: `Ask the owner to confirm removing ${person.name} first. Agents would stop connecting callers to them and stop informing them.` };
      }
      deleteTransfer(orgId, person.id);
      const left = transferTargets(orgId);
      return {
        removed: true,
        person: person.name,
        note: left.length
          ? `People still listed: ${left.map((p) => p.name).join(", ")}.`
          : "Nobody is listed now, so agents can neither connect a caller to a person nor inform anyone after a call.",
      };
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
    case "update_appointment_type": {
      const type = findAppointmentType(orgId, str(args.appointment_type));
      if (!type) return { error: `Nothing bookable called ${str(args.appointment_type) ?? "that"}. Types: ${appointmentTypes(orgId).map((a) => a.name).join(", ") || "none"}.` };
      const name = str(args.name) ?? type.name;
      upsertAppointmentType(orgId, {
        id: type.id,
        name,
        durationMin: typeof args.duration_min === "number" ? Math.round(args.duration_min) : type.durationMin,
        hours: str(args.hours) ?? type.hours,
        location: str(args.location) ?? type.location,
        notes: str(args.notes) ?? type.notes,
      });
      return { saved: true, appointment_type: name, note: "Tell the owner what changed in one line." };
    }
    case "remove_appointment_type": {
      const type = findAppointmentType(orgId, str(args.appointment_type));
      if (!type) return { error: `Nothing bookable called ${str(args.appointment_type) ?? "that"}. Types: ${appointmentTypes(orgId).map((a) => a.name).join(", ") || "none"}.` };
      if (args.confirmed !== true) {
        return { removed: false, note: `Ask the owner to confirm removing "${type.name}" first. Bookings already made are kept; agents stop offering it.` };
      }
      deleteAppointmentType(orgId, type.id);
      return { removed: true, appointment_type: type.name };
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
                    if (HUMAN_MODES.includes(a.when_person_needed as HumanMode)) {
                      bits.push(`when a person is needed: ${HUMAN_MODE_SHORT[a.when_person_needed as HumanMode]} (humanMode ${a.when_person_needed})`);
                    }
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
          when_person_needed: a.humanMode,
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
        when_person_needed: agent.humanMode,
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
  "lookup_order", "register_complaint", "lookup_ticket", "notify_stakeholder", "update_ticket", "resolve_ticket",
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
  const mode = str(args.when_person_needed);
  if (mode && (HUMAN_MODES as readonly string[]).includes(mode) && mode !== agent.humanMode) {
    patch.humanMode = mode as HumanMode;
    changed.push(`when a person is needed → ${HUMAN_MODE_SHORT[patch.humanMode].toLowerCase()}`);
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
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/** One person as Swara reads them back: who, and how they are reached. */
/**
 * What the workspace already holds, in the words Swara uses. Returned by
 * get_setup_status, and put in front of her on every typed turn so she
 * never asks the owner for something that is already on file.
 */
export function setupSnapshot(orgId: string): Record<string, unknown> {
  const s = setupStatus(orgId);
  const book = publicPlaybook(orgId);
  return {
    business: s.playbook.businessType || "not described yet",
    use_case: String(s.playbook.extra.useCase ?? "not set"),
    hours: s.playbook.hours,
    agents_do: {
      take_complaints: book.features.complaints,
      book_appointments: book.features.appointments,
      look_up_orders: book.features.orders,
      pass_to_people: book.humanEscalation,
      outbound_calls: book.hasSales,
    },
    people: transferTargets(orgId).map(personLine),
    teams: teams(orgId).map((t) => ({
      name: t.name,
      routing_words: t.keywords,
      shared_inbox: t.email || null,
    })),
    appointment_types: appointmentTypes(orgId).map((a) => ({
      name: a.name,
      duration_min: a.durationMin,
      hours: a.hours || null,
      location: a.location || null,
    })),
    knowledge_docs: s.knowledge,
    agents: listAgents(orgId).map((a) => ({ name: a.name, when_person_needed: a.humanMode })),
    note:
      "Teams are optional. With no teams, anything an agent files goes to the default person. An empty people list means agents can neither connect a caller to anyone nor inform anyone.",
  };
}

function personLine(p: Person) {
  const reach = [p.contactCalls ? `calls on ${p.phone}` : "", p.contactEmail ? `email at ${p.email}` : ""].filter(Boolean).join(" and ");
  return `${p.name} (${p.role}${p.department ? `, ${p.department} team` : ""}) — ${reach || "no way to reach them yet"}${p.isDefault ? "; default contact" : ""}`;
}

function reachNote(p: Person | undefined) {
  if (!p) return "Saved.";
  if (p.contactCalls && p.contactEmail) return `Agents can connect a caller to ${p.name}, and ${p.name} gets a call and an email about things left after a call.`;
  if (p.contactCalls) return `Agents can connect a caller to ${p.name}, and ${p.name} is called about things left after a call. No email.`;
  return `${p.name} is told by email after a call. Agents cannot connect a caller to them live — there is no phone ticked.`;
}

/** undefined = no team asked for; null = asked for one that does not exist. */
function teamByName(orgId: string, name: string | undefined) {
  if (!name) return undefined;
  return findTeam(orgId, name) ?? null;
}
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
  const callerPhone = callPhone(orgId, callId);
  const staff = callerPhone ? matchStaffContact(orgId, callerPhone) : null;
  const phone = str(args.phone) ?? (reference || staff ? undefined : callerPhone);

  let hits = lookupTickets(orgId, {
    reference,
    customerName: str(args.customer_name),
    phone,
  });
  // If a designated staff member calls lookup_ticket without a reference,
  // return the tickets in their department / field of view.
  if (!hits.length && staff && !reference) {
    hits = ticketsForStaff(orgId, staff, true);
  }
  // A wrong-by-one reference or a misheard name should not dead-end the
  // caller when the phone they are on identifies them.
  if (!hits.length && !staff && callerPhone) {
    hits = lookupTickets(orgId, { phone: callerPhone });
  }
  if (!hits.length) {
    return {
      found: false,
      note: staff
        ? "No matching ticket found in the queue for that reference."
        : "No ticket for this caller — not by that reference, and none filed from the number they are calling from. Say so plainly; do not suggest their complaint is 'still updating'. Offer to file it now.",
    };
  }
  const t = hits[0];
  const stageWord = t.stage === "resolved" ? "closed — marked done" : t.stage === "in_progress" ? "in progress — the desk is working on it" : t.stage === "escalated" ? "escalated" : "open — filed, waiting to be picked up";
  return {
    found: true,
    reference_number: t.ref,
    kind: t.kind,
    title: t.title,
    detail: t.detail || undefined,
    severity: t.severity,
    category: t.category,
    stage: t.stage,
    status_in_words: stageWord,
    customer_name: t.customerName,
    customer_phone: staff ? t.phone : undefined,
    department: t.department,
    opened_at: t.openedAt,
    matches: hits.length,
    others: hits.slice(1, 5).map((o) => ({ reference_number: o.ref, title: o.title, stage: o.stage, customer_name: o.customerName })),
    note:
      t.stage === "resolved"
        ? "This ticket is already marked done. Tell the caller that and ask if a new issue came up."
        : `Routed to ${t.department ?? "the team"}. Status: ${stageWord}.${hits.length > 1 ? ` There are ${hits.length} matching tickets.` : ""}`,
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

function updateTicketTool(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const callerPhone = callPhone(orgId, callId);
  const staff = callerPhone ? matchStaffContact(orgId, callerPhone) : null;
  return updateTicket(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    stage: str(args.stage),
    note: str(args.note),
    updatedBy: str(args.updated_by) ?? staff?.name ?? "agent",
  });
}

function resolveTicketTool(orgId: string, callId: string | null, args: Record<string, unknown>) {
  const callerPhone = callPhone(orgId, callId);
  const staff = callerPhone ? matchStaffContact(orgId, callerPhone) : null;
  return resolveTicket(orgId, {
    reference: str(args.reference_number) ?? str(args.reference),
    note: str(args.note),
    closedBy: str(args.closed_by) ?? staff?.name ?? "agent",
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

function transferHuman(orgId: string, callId: string | null, args: Record<string, unknown>) {
  if (playbook(orgId).extra.humanEscalation === false) {
    return {
      error: "The owner said there is no human to transfer to. Say that, take a name and callback number, and do not offer a transfer.",
    };
  }
  // This agent's own setting: some agents only note things down and the
  // person is told after the call.
  const agentRow = callId
    ? (getDb()
        .prepare("SELECT a.human_mode FROM calls c JOIN agents a ON a.id=c.agent_id AND a.org_id=c.org_id WHERE c.id=? AND c.org_id=?")
        .get(callId, orgId) as { human_mode: string | null } | undefined)
    : undefined;
  if (agentRow && !canConnectLive(normaliseHumanMode(agentRow.human_mode))) {
    return {
      error:
        "This agent does not connect callers to a person during the call. Take down what they need (file it with register_complaint if you can) and tell them the right person will be informed and will get back to them.",
    };
  }
  // Only people who ticked Calls can be put on a call.
  const targets = liveTransferPeople(orgId);
  if (targets.length === 0) {
    return {
      error: "Nobody is set up to take calls. Take a callback number and say someone will get back to them. Do not invent a person.",
    };
  }
  const asked = String(args.target_name ?? "").toLowerCase().trim();
  const reason = String(args.reason ?? "").trim();
  const search = `${asked} ${reason.toLowerCase()}`;
  const target =
    (asked &&
      targets.find(
        (t) =>
          t.name.toLowerCase().includes(asked) ||
          t.role.toLowerCase().includes(asked) ||
          (t.department ?? "").toLowerCase().includes(asked) ||
          t.whenToUse.toLowerCase().includes(asked),
      )) ||
    targets.find(
      (t) =>
        (t.department && search.includes(t.department.toLowerCase())) ||
        search.includes(t.role.toLowerCase()),
    ) ||
    targets.find((t) => t.isDefault) ||
    targets[0];

  if (callId) {
    getDb()
      .prepare("UPDATE calls SET outcome='escalated' WHERE id=? AND org_id=?")
      .run(callId, orgId);
    // Link any open ticket from this call or caller to the designated person
    // so it appears in their field of view when they follow up or call back.
    const callerPhone = callPhone(orgId, callId);
    const openTicket = (
      getDb()
        .prepare("SELECT id FROM complaints WHERE org_id=? AND call_id=? AND stage!='resolved' ORDER BY opened_at DESC LIMIT 1")
        .get(orgId, callId) as { id: string } | undefined
    ) ?? (callerPhone ? lookupTickets(orgId, { phone: callerPhone }).find((t) => t.stage !== "resolved") : undefined);

    if (openTicket) {
      // A ticket sitting in the Unassigned queue moves to this person's
      // team, if they have one; a ticket a team already owns stays put.
      getDb()
        .prepare(
          `UPDATE complaints SET assignee=?,
             department_id=CASE WHEN ? IS NOT NULL AND (department_id IS NULL OR department_id IN
               (SELECT id FROM departments WHERE org_id=? AND slug='unassigned')) THEN ? ELSE department_id END
           WHERE id=? AND org_id=?`,
        )
        .run(target.name, target.departmentId ?? null, orgId, target.departmentId ?? null, openTicket.id, orgId);
      updateComplaintStage(orgId, openTicket.id, "escalated");
      addTicketMessage({
        orgId,
        complaintId: openTicket.id,
        direction: "out",
        channel: "call",
        toAddress: target.phone,
        body: `Call warm-transferred to ${target.name} (${target.role})${reason ? `: ${reason}` : ""}.`,
      });
    }
  }

  return {
    transferred: true,
    to: target.name,
    role: target.role,
    hours: target.hours,
    reason,
    note: `Tell the caller in one short sentence that you are connecting them to ${target.name} (${target.role}), then stop speaking while the call bridges.`,
    // On a phone leg the bridge dials this number and drops out; in the
    // browser test bench it is shown as a caption. If nobody picks up, the
    // bridge reports back and the person is informed after the call.
    __control: { kind: "transfer", phone: target.phone, name: target.name },
  };
}
