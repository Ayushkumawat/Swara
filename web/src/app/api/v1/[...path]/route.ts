import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AGENT_TEMPLATES, templateById } from "@/lib/agents/templates";
import { currentUser, login, logout, signup, type SessionUser } from "@/lib/server/auth";
import * as repo from "@/lib/server/repo";
import { finishCall } from "@/lib/server/pipeline";
import { executeTool } from "@/lib/server/tools";
import { ingestKnowledgeDoc } from "@/lib/server/ai";
import * as ws from "@/lib/server/workspace";

/**
 * The whole API surface in one router.
 *
 * Twenty-something GET endpoints that differ only in which repo function they
 * call don't deserve twenty-something files of identical ceremony; a table
 * keeps the path list diffable against `lib/api/client.ts`, which is the
 * contract this must serve. Anything with real logic (auth, call completion,
 * tool execution) gets its own handler below.
 *
 * Everything requires a session except login/signup. Reads are org-scoped by
 * the session's org; a department-scoped user gets their department's slice
 * where that matters (the action queue).
 */

export const runtime = "nodejs";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/* ── GET table ────────────────────────────────────────────────────────────── */

const GETS: Record<string, (user: SessionUser) => unknown | Promise<unknown>> = {
  "overview": (u) => repo.overview(u.orgId),
  "agents": (u) => repo.agents(u.orgId),
  "agents/versions": (u) => repo.agentVersions(u.orgId),
  "agents/knowledge": (u) => repo.knowledgeDocs(u.orgId),
  "calls/live": (u) => repo.liveCalls(u.orgId),
  "calls": (u) => repo.callRecords(u.orgId),
  "campaigns": (u) => repo.campaigns(u.orgId),
  "campaigns/scrub-status": (u) => repo.configBlob(u.orgId, "scrub_status"),
  "bookings": (u) => repo.bookings(u.orgId),
  "complaints": (u) => repo.complaints(u.orgId),
  "customers": (u) => repo.customers(u.orgId),
  "voices": (u) => ws.voices(u.orgId),
  "voices/script-tests": (u) => repo.configBlob(u.orgId, "script_tests"),
  "numbers": (u) => repo.numbers(u.orgId),
  "numbers/security": (u) => repo.configBlob(u.orgId, "security_settings"),
  "numbers/trunks": (u) => {
    const rows = ws.sipTrunks(u.orgId);
    return rows.length ? rows : repo.configBlob(u.orgId, "sip_trunks");
  },
  "integrations": (u) => repo.configBlob(u.orgId, "integrations"),
  "agents/templates": () =>
    AGENT_TEMPLATES.map(({ id, name, blurb, intent, direction, needs }) => ({
      id, name, blurb, intent, direction, needs,
    })),
  "setup": (u) => ws.setupStatus(u.orgId),
  "setup/playbook": (u) => publicPlaybook(u.orgId),
  "setup/transfers": (u) => ws.transferTargets(u.orgId),
  "setup/appointments": (u) => ws.appointmentTypes(u.orgId),
  "setup/connectors": (u) => ws.connectors(u.orgId),
  "analytics": (u) => repo.analytics(u.orgId),
  "billing/usage": (u) => repo.usage(u.orgId),
  "billing/invoices": (u) => repo.invoices(u.orgId),
  "compliance": (u) => repo.configBlob(u.orgId, "compliance"),
  "team": (u) => repo.team(u.orgId),
  "api-keys": (u) => repo.apiKeys(u.orgId),
  "notifications": (u) => repo.notifications(u.orgId),
  "departments": (u) => repo.departments(u.orgId),
  // Department users see their queue; org-wide roles see all departments.
  "actions": (u) => repo.actions(u.orgId, u.departmentId),
  "auth/me": (u) => ({ user: u }),
};

function publicPlaybook(orgId: string) {
  const p = ws.playbook(orgId);
  return {
    orgId: p.orgId,
    businessType: p.businessType,
    hours: p.hours,
    transferPolicy: p.transferPolicy,
    bookingPolicy: p.bookingPolicy,
    complaintSlaHours: p.complaintSlaHours,
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = path.join("/");
  const user = await currentUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const handler = GETS[key];
  if (handler) return json(await handler(user));

  if (path[0] === "campaigns" && path[1] && path[2] === "contacts") {
    return json(ws.campaignContacts(user.orgId, path[1]));
  }

  return json({ error: `No route /${key}` }, 404);
}

/* ── POST ─────────────────────────────────────────────────────────────────── */

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const SignupBody = z.object({
  orgName: z.string().min(2),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
const CompleteBody = z.object({
  callId: z.string(),
  durationSec: z.number().int().min(0),
  tokens: z.number().int().min(0),
  transcript: z.array(z.object({ role: z.string(), text: z.string() })).max(2000),
});
const ToolBody = z.object({
  callId: z.string().nullable(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
const PayBody = z.object({ invoiceId: z.string() });
const KnowledgeBody = z.object({
  name: z.string().min(1),
  kind: z.enum(["pdf", "url", "csv", "text"]).default("text"),
  /** Extracted text. Parsing PDFs/crawling URLs belongs in a worker later;
   *  the API takes text so the pipeline downstream is already real. */
  text: z.string().min(20).max(500_000),
});
const CreateAgentBody = z.object({
  name: z.string().min(1).optional(),
  templateId: z.string().optional(),
  intent: z.string().optional(),
  direction: z.enum(["inbound", "outbound", "both"]).optional(),
  prompt: z.string().optional(),
});
const PlaybookBody = z.object({
  businessType: z.string().optional(),
  hours: z.string().optional(),
  transferPolicy: z.string().optional(),
  bookingPolicy: z.string().optional(),
  complaintSlaHours: z.number().int().min(1).max(168).optional(),
});
const DepartmentBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  slug: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});
const TransferBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  role: z.string().min(1),
  phone: z.string().min(8),
  hours: z.string().optional(),
  whenToUse: z.string().min(1),
  departmentId: z.string().nullable().optional(),
  priority: z.number().int().optional(),
});
const AppointmentBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  durationMin: z.number().int().min(5).max(480),
  hours: z.string().optional(),
  days: z.array(z.string()).optional(),
  location: z.string().optional(),
  bufferMin: z.number().int().min(0).max(240).optional(),
  notes: z.string().optional(),
});
const ConnectorBody = z.object({
  name: z.string().min(1),
  kind: z.enum(["rest", "demo"]).default("demo"),
  tool: z.string().min(1),
  baseUrl: z.string().optional(),
  authHeader: z.string().optional(),
  authSecret: z.string().optional(),
});
const CreateCampaignBody = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  series: z.enum(["140", "160"]),
});
const ContactsBody = z.object({
  contacts: z.array(
    z.object({
      phone: z.string().min(8),
      name: z.string().optional(),
      language: z.string().optional(),
    }),
  ).min(1).max(5000),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = path.join("/");
  const body = await req.json().catch(() => ({}));

  if (key === "auth/login") {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) return json({ error: "Email and password required" }, 400);
    const user = await login(
      parsed.data.email,
      parsed.data.password,
      req.headers.get("user-agent") ?? undefined,
    );
    // One message for both failure modes; see auth.ts.
    if (!user) return json({ error: "Invalid email or password" }, 401);
    return json({ user });
  }

  if (key === "auth/signup") {
    const parsed = SignupBody.safeParse(body);
    if (!parsed.success) {
      return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
    }
    const result = await signup(parsed.data.orgName, parsed.data.name, parsed.data.email, parsed.data.password);
    if (result.error) return json({ error: result.error }, 409);
    const user = await login(parsed.data.email, parsed.data.password, req.headers.get("user-agent") ?? undefined);
    return json({ user });
  }

  if (key === "auth/logout") {
    await logout();
    return json({ ok: true });
  }

  // Live-call support routes. These fall back to the demo org when no session
  // exists, because the onboarding "hear it work" call runs before signup —
  // the same reason the token mint route does.
  const user = await currentUser();
  const orgId = user?.orgId ?? "org_demo";

  if (key === "calls/complete") {
    const parsed = CompleteBody.safeParse(body);
    if (!parsed.success) return json({ error: "Bad completion payload" }, 400);
    await finishCall({ orgId, ...parsed.data });
    return json({ ok: true });
  }

  if (key === "tools/execute") {
    const parsed = ToolBody.safeParse(body);
    if (!parsed.success) return json({ error: "Bad tool payload" }, 400);
    const result = await executeTool(orgId, parsed.data.callId, parsed.data.name, parsed.data.args);
    return json({ result });
  }

  if (key === "agents/knowledge") {
    if (!user) return json({ error: "Not signed in" }, 401);
    const parsed = KnowledgeBody.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid document" }, 400);
    const doc = await ingestKnowledgeDoc(user.orgId, parsed.data.name, parsed.data.kind, parsed.data.text);
    return json(doc, 201);
  }

  if (key === "billing/pay") {
    if (!user) return json({ error: "Not signed in" }, 401);
    const parsed = PayBody.safeParse(body);
    if (!parsed.success) return json({ error: "invoiceId required" }, 400);
    const result = repo.payInvoice(user.orgId, parsed.data.invoiceId, user.email);
    if (result.error) return json({ error: result.error }, 400);
    return json({ ok: true, paymentId: result.paymentId });
  }

  if (!user) return json({ error: "Not signed in" }, 401);

  if (key === "agents") {
    const parsed = CreateAgentBody.safeParse(body);
    if (!parsed.success) return json({ error: "name or templateId required" }, 400);
    const tpl = parsed.data.templateId ? templateById(parsed.data.templateId) : undefined;
    if (parsed.data.templateId && !tpl) return json({ error: "Unknown template" }, 404);
    const id = repo.createAgent(user.orgId, {
      name: parsed.data.name ?? tpl?.name ?? "New agent",
      intent: parsed.data.intent ?? tpl?.intent ?? "other",
      direction: parsed.data.direction ?? tpl?.direction ?? "inbound",
      prompt: parsed.data.prompt ?? tpl?.prompt,
      nodes: tpl?.nodes,
      edges: tpl?.edges,
    });
    return json({ id }, 201);
  }

  if (key === "setup/playbook") {
    const parsed = PlaybookBody.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid playbook" }, 400);
    ws.upsertPlaybook(user.orgId, parsed.data);
    return json(publicPlaybook(user.orgId));
  }

  if (key === "departments") {
    const parsed = DepartmentBody.safeParse(body);
    if (!parsed.success) return json({ error: "Department name required" }, 400);
    return json(ws.upsertDepartment(user.orgId, parsed.data));
  }

  if (key === "setup/transfers") {
    const parsed = TransferBody.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid transfer" }, 400);
    return json(ws.upsertTransfer(user.orgId, parsed.data));
  }

  if (key === "setup/appointments") {
    const parsed = AppointmentBody.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid appointment type" }, 400);
    return json(ws.upsertAppointmentType(user.orgId, parsed.data));
  }

  if (key === "setup/connectors") {
    const parsed = ConnectorBody.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid connector" }, 400);
    return json(ws.upsertConnector(user.orgId, parsed.data));
  }

  if (key === "campaigns") {
    const parsed = CreateCampaignBody.safeParse(body);
    if (!parsed.success) return json({ error: "name, agentId and series required" }, 400);
    return json({ id: repo.createCampaign(user.orgId, parsed.data) }, 201);
  }

  if (path[0] === "campaigns" && path[1] && path[2] === "contacts") {
    const parsed = ContactsBody.safeParse(body);
    if (!parsed.success) return json({ error: "contacts[] required" }, 400);
    return json(ws.addCampaignContacts(user.orgId, path[1], parsed.data.contacts));
  }

  return json({ error: `No route /${key}` }, 404);
}

/* ── PATCH ────────────────────────────────────────────────────────────────── */

const ActionPatch = z.object({ status: z.enum(["open", "in_progress", "done"]) });
const AgentPatch = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().optional(),
  status: z.enum(["live", "draft", "testing", "paused"]).optional(),
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
  voiceId: z.string().optional(),
});
const VoicePatch = z.object({
  promptTemplate: z.string().optional(),
  personaName: z.string().optional(),
  pace: z.number().optional(),
  formality: z.number().optional(),
  warmth: z.number().optional(),
  assignedAgentId: z.string().nullable().optional(),
});
const CampaignPatch = z.object({
  status: z.enum(["running", "paused", "scheduled", "completed", "draft"]),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const user = await currentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  const body = await req.json().catch(() => ({}));

  if (path[0] === "actions" && path[1]) {
    const parsed = ActionPatch.safeParse(body);
    if (!parsed.success) return json({ error: "status must be open|in_progress|done" }, 400);
    repo.updateAction(user.orgId, path[1], parsed.data.status, user.name);
    return json({ ok: true, id: path[1], status: parsed.data.status });
  }

  if (path[0] === "agents" && path[1]) {
    const parsed = AgentPatch.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid agent update" }, 400);
    const result = repo.updateAgent(user.orgId, path[1], parsed.data);
    if (result.error) return json({ error: result.error }, 404);
    return json({ ok: true, id: path[1] });
  }

  if (path[0] === "voices" && path[1]) {
    const parsed = VoicePatch.safeParse(body);
    if (!parsed.success) return json({ error: "Invalid voice update" }, 400);
    const result = ws.updateVoice(user.orgId, path[1], parsed.data);
    if (result.error) return json({ error: result.error }, 404);
    return json({ ok: true });
  }

  if (path[0] === "campaigns" && path[1]) {
    const parsed = CampaignPatch.safeParse(body);
    if (!parsed.success) return json({ error: "status required" }, 400);
    repo.updateCampaign(user.orgId, path[1], parsed.data.status);
    return json({ ok: true });
  }

  return json({ error: `No route /${path.join("/")}` }, 404);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const user = await currentUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  if (path[0] === "departments" && path[1]) {
    const result = ws.deleteDepartment(user.orgId, path[1]);
    if (result.error) return json({ error: result.error }, 400);
    return json({ ok: true });
  }

  if (path[0] === "setup" && path[1] === "transfers" && path[2]) {
    ws.deleteTransfer(user.orgId, path[2]);
    return json({ ok: true });
  }

  if (path[0] === "setup" && path[1] === "appointments" && path[2]) {
    ws.deleteAppointmentType(user.orgId, path[2]);
    return json({ ok: true });
  }

  return json({ error: `No route /${path.join("/")}` }, 404);
}
