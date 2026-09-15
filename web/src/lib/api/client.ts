import type { ZodType } from "zod";
import * as fx from "./fixtures";
import {
  ActionItemSchema,
  AgentPlanSchema,
  type AgentPlan,
  AgentSchema,
  AgentTemplateSchema,
  AgentVersionSchema,
  AppointmentTypeSchema,
  CampaignContactSchema,
  ConnectorRowSchema,
  DepartmentSchema,
  InvoiceSchema,
  PlaybookSchema,
  SessionUserSchema,
  SetupStatusSchema,
  TransferTargetSchema,
  AnalyticsSchema,
  ApiKeySchema,
  BookingSchema,
  CampaignSchema,
  ComplaintSchema,
  ComplianceItemSchema,
  CustomerSchema,
  IntegrationSchema,
  KnowledgeDocSchema,
  LiveCallSchema,
  NotificationSchema,
  OverviewSchema,
  PhoneNumberSchema,
  ScriptTestSchema,
  ScrubStatusSchema,
  SecuritySettingSchema,
  SipTrunkSchema,
  TeamMemberSchema,
  UsageSchema,
  VoiceSchema,
} from "./schemas";
import { z } from "zod";

/**
 * One transport, two adapters.
 *
 * With NEXT_PUBLIC_API_BASE_URL unset the console runs entirely on the demo
 * dataset in fixtures.ts. Set it and every call goes to the real backend over
 * HTTP, still parsed through the same Zod schema — so a backend response that
 * drifts from the contract fails loudly here instead of rendering as
 * `undefined` somewhere deep in a table.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
export const IS_MOCK = API_BASE === "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mock latency, so skeletons and streaming states are exercised in dev
 *  rather than only appearing for the first time in production. */
const LATENCY_MS = { min: 180, max: 520 };

function mockDelay() {
  const ms = LATENCY_MS.min + Math.random() * (LATENCY_MS.max - LATENCY_MS.min);
  return new Promise((r) => setTimeout(r, ms));
}

/** Registry of GET responses in mock mode. Keys are the same paths the real
 *  backend must serve. */
const MOCK_ROUTES: Record<string, () => unknown> = {
  "/overview": () => fx.overview,
  "/agents": () => fx.agents,
  "/agents/versions": () => fx.agentVersions,
  "/agents/knowledge": () => fx.knowledgeDocs,
  "/calls/live": () => fx.liveCalls,
  "/calls": () => fx.callRecords,
  "/campaigns": () => fx.campaigns,
  "/campaigns/scrub-status": () => fx.scrubStatus,
  "/bookings": () => fx.bookings,
  "/complaints": () => fx.complaints,
  "/customers": () => fx.customers,
  "/voices": () => fx.voices,
  "/voices/script-tests": () => fx.scriptTests,
  "/numbers": () => fx.phoneNumbers,
  "/numbers/security": () => fx.securitySettings,
  "/numbers/trunks": () => fx.sipTrunks,
  "/integrations": () => fx.integrations,
  "/analytics": () => fx.analytics,
  "/billing/usage": () => fx.usage,
  "/compliance": () => fx.complianceItems,
  "/team": () => fx.teamMembers,
  "/api-keys": () => fx.apiKeys,
  "/notifications": () => fx.notifications,
  "/departments": () => fx.departments,
  "/actions": () => fx.actionQueue,
  "/billing/invoices": () => fx.invoices,
  "/auth/me": () => ({ user: fx.me }),
  "/setup/playbook": () => ({
    orgId: "org_demo",
    businessType: "D2C + civic helpline (demo)",
    hours: "10:00-19:00 IST",
    transferPolicy: "Transfer on the second stuck turn.",
    bookingPolicy: "Only offer configured slots.",
    complaintSlaHours: 24,
    useCase: "ecommerce",
    hasSales: false,
    humanEscalation: true,
  }),
  "/setup": () => ({ departments: 6, transfers: 1, appointmentTypes: 1, knowledge: 3, connectors: 1, voices: 5, agents: 6 }),
  "/setup/transfers": () => [
    { id: "xfer_demo", name: "Priya Desai", role: "Support lead", phone: "+919820011122", hours: "10:00-19:00 IST", whenToUse: "Angry caller or they asked for a supervisor", departmentId: "dept_support", department: "Customer Support", priority: 0 },
  ],
  "/setup/appointments": () => [
    { id: "apt_demo", name: "Home delivery slot", durationMin: 60, hours: "10:00-21:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"], location: "Caller address", bufferMin: 15, notes: "Offer two windows" },
  ],
  "/setup/connectors": () => [
    { id: "conn_demo", name: "Demo orders", kind: "demo", tool: "lookup_order", baseUrl: "", authHeader: "", status: "connected", hasSecret: false },
  ],
  "/agents/templates": () => [
    { id: "tpl_order", name: "Order status", blurb: "Look up a live order.", intent: "order_status", direction: "inbound", needs: ["orders"] },
    { id: "tpl_grievance", name: "Complaint intake", blurb: "File a complaint.", intent: "complaint", direction: "inbound", needs: ["departments"] },
    { id: "tpl_booking", name: "Appointment booking", blurb: "Offer two slots.", intent: "booking", direction: "inbound", needs: ["appointments"] },
    { id: "tpl_delivery", name: "Delivery reschedule", blurb: "Pick a new slot.", intent: "delivery_reschedule", direction: "both", needs: ["appointments", "orders"] },
    { id: "tpl_lead", name: "Lead qualification", blurb: "Qualify, book next step.", intent: "sales_enquiry", direction: "outbound", needs: ["transfers", "appointments"] },
    { id: "tpl_cod", name: "Payment reminder", blurb: "Remind, never collect.", intent: "payment_reminder", direction: "outbound", needs: ["orders"] },
  ],
};

export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  if (IS_MOCK) {
    await mockDelay();
    const resolver = MOCK_ROUTES[path];
    if (resolver) return schema.parse(resolver());
    if (/^\/campaigns\/[^/]+\/contacts$/.test(path)) return schema.parse([]);
    throw new ApiError(`No mock route for ${path}`, 404, path);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw handleHttpError(res.status, path, await res.text());
  return schema.parse(await res.json());
}

/**
 * A 401 means the session expired or never existed; every query on the page
 * will fail the same way, so the sane response is one redirect to login, not
 * twenty error toasts. `/login` is excluded to avoid a loop while typing a
 * wrong password.
 */
function handleHttpError(status: number, path: string, body: string): ApiError {
  if (status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
    if (!window.location.pathname.startsWith("/login")) {
      // A hard navigation on purpose: the session is dead, so React Query's
      // cache and any in-memory state belong to a user who is no longer
      // signed in. A router.push would carry all of it to the login screen.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }
  return new ApiError(body, status, path);
}

export async function apiSend<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T> {
  if (IS_MOCK) {
    await mockDelay();
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return schema.parse({
      id: "mock",
      ok: true,
      added: Array.isArray(record.contacts) ? record.contacts.length : 0,
      slug: "mock",
      ...record,
    });
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw handleHttpError(res.status, path, await res.text());
  return schema.parse(await res.json());
}

/* ── Endpoint map ───────────────────────────────────────────────────────────
   This is the list your backend needs to implement. Each entry is
   [path, response schema]. */

export const endpoints = {
  overview: () => apiGet("/overview", OverviewSchema),
  agents: () => apiGet("/agents", z.array(AgentSchema)),
  agentVersions: () => apiGet("/agents/versions", z.array(AgentVersionSchema)),
  knowledge: () => apiGet("/agents/knowledge", z.array(KnowledgeDocSchema)),
  liveCalls: () => apiGet("/calls/live", z.array(LiveCallSchema)),
  campaigns: () => apiGet("/campaigns", z.array(CampaignSchema)),
  scrubStatus: () => apiGet("/campaigns/scrub-status", ScrubStatusSchema),
  bookings: () => apiGet("/bookings", z.array(BookingSchema)),
  complaints: () => apiGet("/complaints", z.array(ComplaintSchema)),
  customers: () => apiGet("/customers", z.array(CustomerSchema)),
  voices: () => apiGet("/voices", z.array(VoiceSchema)),
  scriptTests: () => apiGet("/voices/script-tests", z.array(ScriptTestSchema)),
  numbers: () => apiGet("/numbers", z.array(PhoneNumberSchema)),
  security: () => apiGet("/numbers/security", z.array(SecuritySettingSchema)),
  trunks: () => apiGet("/numbers/trunks", z.array(SipTrunkSchema)),
  integrations: () => apiGet("/integrations", z.array(IntegrationSchema)),
  analytics: () => apiGet("/analytics", AnalyticsSchema),
  usage: () => apiGet("/billing/usage", UsageSchema),
  compliance: () => apiGet("/compliance", z.array(ComplianceItemSchema)),
  team: () => apiGet("/team", z.array(TeamMemberSchema)),
  apiKeys: () => apiGet("/api-keys", z.array(ApiKeySchema)),
  notifications: () => apiGet("/notifications", z.array(NotificationSchema)),
  departments: () => apiGet("/departments", z.array(DepartmentSchema)),
  actions: () => apiGet("/actions", z.array(ActionItemSchema)),
  invoices: () => apiGet("/billing/invoices", z.array(InvoiceSchema)),
  me: () => apiGet("/auth/me", z.object({ user: SessionUserSchema })),
  playbook: () => apiGet("/setup/playbook", PlaybookSchema),
  setupStatus: () => apiGet("/setup", SetupStatusSchema),
  transfers: () => apiGet("/setup/transfers", z.array(TransferTargetSchema)),
  appointmentTypes: () => apiGet("/setup/appointments", z.array(AppointmentTypeSchema)),
  connectors: () => apiGet("/setup/connectors", z.array(ConnectorRowSchema)),
  templates: () => apiGet("/agents/templates", z.array(AgentTemplateSchema)),
  campaignContacts: (id: string) => apiGet(`/campaigns/${id}/contacts`, z.array(CampaignContactSchema)),
} as const;

/* ── Mutations ──────────────────────────────────────────────────────────── */

export const mutations = {
  login: (email: string, password: string) =>
    apiSend("POST", "/auth/login", { email, password }, z.object({ user: SessionUserSchema })),
  signup: (orgName: string, name: string, email: string, password: string) =>
    apiSend("POST", "/auth/signup", { orgName, name, email, password }, z.object({ user: SessionUserSchema })),
  logout: () => apiSend("POST", "/auth/logout", {}, z.object({ ok: z.boolean() })),
  updateAction: (id: string, status: "open" | "in_progress" | "done") =>
    apiSend("PATCH", `/actions/${id}`, { status }, z.object({ ok: z.boolean(), id: z.string(), status: z.string() }).or(z.object({ status: z.string() }))),
  payInvoice: (invoiceId: string) =>
    apiSend("POST", "/billing/pay", { invoiceId }, z.object({ ok: z.boolean().optional(), paymentId: z.string().optional(), invoiceId: z.string().optional() })),
  createAgent: (body: unknown) =>
    apiSend("POST", "/agents", body, z.object({ id: z.string() })),
  updateAgent: (id: string, body: unknown) =>
    apiSend("PATCH", `/agents/${id}`, body, z.object({ ok: z.boolean(), id: z.string() })),
  deleteAgent: (id: string) =>
    apiSend("DELETE", `/agents/${id}`, { ok: true }, z.object({ ok: z.boolean() })),
  planAgents: (body: { brief: string; answers?: Record<string, string> }) =>
    apiSend("POST", "/agents/plan", body, AgentPlanSchema),
  applyPlan: (plan: Pick<AgentPlan, "agents">) =>
    apiSend(
      "POST",
      "/agents/plan/apply",
      { plan },
      z.object({ created: z.array(z.object({ key: z.string(), id: z.string(), name: z.string() })) }),
    ),
  savePlaybook: (body: unknown) =>
    apiSend("POST", "/setup/playbook", body, PlaybookSchema),
  saveDepartment: (body: unknown) =>
    apiSend("POST", "/departments", body, z.object({ id: z.string(), slug: z.string() })),
  deleteDepartment: (id: string) =>
    apiSend("DELETE", `/departments/${id}`, {}, z.object({ ok: z.boolean() }).or(z.object({ error: z.string() }))),
  saveTransfer: (body: unknown) =>
    apiSend("POST", "/setup/transfers", body, z.object({ id: z.string() })),
  deleteTransfer: (id: string) =>
    apiSend("DELETE", `/setup/transfers/${id}`, {}, z.object({ ok: z.boolean() })),
  saveAppointment: (body: unknown) =>
    apiSend("POST", "/setup/appointments", body, z.object({ id: z.string() })),
  deleteAppointment: (id: string) =>
    apiSend("DELETE", `/setup/appointments/${id}`, {}, z.object({ ok: z.boolean() })),
  saveConnector: (body: unknown) =>
    apiSend("POST", "/setup/connectors", body, z.object({ id: z.string() })),
  updateVoice: (id: string, body: unknown) =>
    apiSend("PATCH", `/voices/${id}`, body, z.object({ ok: z.boolean() })),
  createCampaign: (body: unknown) =>
    apiSend("POST", "/campaigns", body, z.object({ id: z.string() })),
  updateCampaign: (id: string, status: string) =>
    apiSend("PATCH", `/campaigns/${id}`, { status }, z.object({ ok: z.boolean() })),
  addContacts: (campaignId: string, contacts: unknown) =>
    apiSend("POST", `/campaigns/${campaignId}/contacts`, { contacts }, z.object({ added: z.number() })),
  addKnowledge: (body: { name: string; kind?: "pdf" | "url" | "csv" | "text"; text: string }) =>
    apiSend("POST", "/agents/knowledge", body, z.object({ id: z.string(), chunks: z.number().optional() }).passthrough()),
} as const;
