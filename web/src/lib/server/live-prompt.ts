import "server-only";
import { getDb } from "./db";
import { agentPrompt } from "@/lib/live/prompts";
import { languageDirective } from "@/lib/live/config";
import { voiceByName, voiceCraft } from "@/lib/live/voices";
import { appointmentTypes, playbook, transferTargets, voices as orgVoices } from "./workspace";

/**
 * Builds the system instruction for a live session from the tenant's own
 * rows — voice craft, transfer desks, appointment types, departments —
 * plus the agent persona. An empty transfer list becomes an instruction
 * not to offer a transfer, which is how we stop the model inventing a
 * person we cannot reach.
 */
export function composeLivePrompt(orgId: string, agentId: string, voiceName?: string) {
  const stored = getDb()
    .prepare("SELECT * FROM agents WHERE id=? AND org_id=?")
    .get(agentId, orgId) as
    | { name: string; prompt: string | null; intent: string }
    | undefined;

  const builtin = agentPrompt(agentId);
  const role = stored?.prompt || builtin?.systemInstruction || defaultRole(stored?.name ?? "this line");

  const catalog = voiceByName(voiceName);
  const saved = orgVoices(orgId).find((v) => v.liveName === catalog.name);
  const voiceBlock = saved?.promptTemplate || voiceCraft(voiceName);
  const persona = saved?.personaName || catalog.personaName;

  const book = playbook(orgId);
  const transfers = transferTargets(orgId);
  const slots = appointmentTypes(orgId);
  const departments = getDb()
    .prepare("SELECT name, keywords FROM departments WHERE org_id=?")
    .all(orgId) as { name: string; keywords: string }[];

  const workspace = [
    book.businessType ? `BUSINESS: ${book.businessType}` : "",
    book.hours ? `HOURS: ${book.hours}` : "",
    book.transferPolicy ? `TRANSFER POLICY: ${book.transferPolicy}` : "",
    book.bookingPolicy ? `BOOKING POLICY: ${book.bookingPolicy}` : "",
    departments.length
      ? `DEPARTMENTS that own follow-up: ${departments.map((d) => d.name).join(", ")}.`
      : "",
    transfers.length
      ? [
          "TRANSFER TARGETS — these are the only humans you may offer. When transferring, call transfer_to_human with their name.",
          ...transfers.map(
            (t) =>
              `- ${t.name} (${t.role}, ${t.phone}${t.hours ? `, ${t.hours}` : ""}): ${t.whenToUse}`,
          ),
        ].join("\n")
      : "TRANSFER: no human desk is configured. Do not offer a transfer. Take a callback number and say someone will call back.",
    slots.length
      ? [
          "APPOINTMENT TYPES you may book — never invent a type or a time outside these hours:",
          ...slots.map(
            (s) =>
              `- ${s.name}: ${s.durationMin} min${s.hours ? `, ${s.hours}` : ""}${s.location ? `, ${s.location}` : ""}${s.notes ? `. ${s.notes}` : ""}`,
          ),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    name: stored?.name ?? builtin?.name ?? "Agent",
    greeting: builtin?.greeting ?? `${persona} speaking. How can I help?`,
    intent: stored?.intent ?? builtinIntent(agentId),
    systemInstruction: [
      `Your name on this call is ${persona}. Introduce yourself as ${persona}.`,
      voiceBlock,
      role,
      workspace,
      languageDirective(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function defaultRole(name: string) {
  return `You are the voice of ${name}. Keep turns short. Use the tools you have been given. Never invent facts.`;
}

function builtinIntent(agentId: string) {
  const map: Record<string, string> = {
    ag_grievance: "complaint",
    ag_delivery: "delivery_reschedule",
    ag_order: "order_status",
    ag_lead: "sales_enquiry",
    ag_booking: "booking",
    ag_cod: "payment_reminder",
  };
  return map[agentId] ?? "other";
}
