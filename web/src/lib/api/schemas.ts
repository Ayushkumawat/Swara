import { z } from "zod";

/**
 * The wire contract between this console and the Swara backend.
 *
 * Everything the UI renders is parsed through these schemas, so the backend
 * can be implemented against this file directly. Where a field encodes an
 * Indian regulatory concept (140/160 series, DLT, DND, quiet hours) it is a
 * closed enum on purpose — project.md §4.3 requires these enforced at the data
 * layer, and a free-form string would let a violation through.
 */

/* ── Shared primitives ──────────────────────────────────────────────────── */

export const LanguageSchema = z.enum([
  "hi",
  "en",
  "hinglish",
  "ta",
  "te",
  "kn",
  "ml",
  "mr",
  "bn",
  "gu",
  "pa",
  "or",
]);
export type Language = z.infer<typeof LanguageSchema>;

export const LANGUAGE_LABEL: Record<Language, string> = {
  hi: "Hindi",
  en: "English",
  hinglish: "Hinglish",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
  or: "Odia",
};

export const SentimentSchema = z.enum([
  "positive",
  "neutral",
  "declining",
  "frustrated",
]);
export type Sentiment = z.infer<typeof SentimentSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** 140 = promotional, 160 = transactional/service. TRAI distinction — a
 *  promotional call placed from a 160 series (or vice versa) is a violation. */
export const NumberSeriesSchema = z.enum(["140", "160"]);
export type NumberSeries = z.infer<typeof NumberSeriesSchema>;

export const IntentSchema = z.enum([
  "order_status",
  "delivery_reschedule",
  "complaint",
  "sales_enquiry",
  "booking",
  "payment_reminder",
  "feedback",
  "other",
]);
export type Intent = z.infer<typeof IntentSchema>;

export const INTENT_LABEL: Record<Intent, string> = {
  order_status: "Order status",
  delivery_reschedule: "Delivery reschedule",
  complaint: "Complaint",
  sales_enquiry: "Sales enquiry",
  booking: "Booking",
  payment_reminder: "Payment reminder",
  feedback: "Feedback",
  other: "Other",
};

/* ── Agents & flows (§4.2) ──────────────────────────────────────────────── */

export const AgentStatusSchema = z.enum(["live", "draft", "testing", "paused"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/** Node kinds map 1:1 to executable units in the flow engine. The node-graph
 *  is the underlying data model even in single-prompt mode (project.md §4.2). */
export const FlowNodeKindSchema = z.enum([
  "start",
  "intent",
  "data_pull",
  "branch",
  "say",
  "collect",
  "book",
  "escalate",
  "handoff",
  "end",
]);
export type FlowNodeKind = z.infer<typeof FlowNodeKindSchema>;

export const FlowNodeSchema = z.object({
  id: z.string(),
  kind: FlowNodeKindSchema,
  title: z.string(),
  detail: z.string().optional(),
  /** Canvas coordinates, persisted so the graph survives a reload. */
  x: z.number(),
  y: z.number(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  tone: z.enum(["default", "success", "danger"]).default("default"),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: AgentStatusSchema,
  languages: z.array(LanguageSchema),
  intent: IntentSchema,
  direction: z.enum(["inbound", "outbound", "both"]),
  voiceId: z.string().optional(),
  /** Live API voice name the agent speaks with ("Orus"). */
  voice: z.string().optional(),
  /** The name the agent introduces itself with on a call. */
  personaName: z.string().optional(),
  mode: z.enum(["graph", "prompt"]),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
  version: z.number(),
  callsToday: z.number(),
  resolutionRate: z.number(),
  updatedAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  label: z.string(),
  author: z.string(),
  createdAt: z.string(),
  isLive: z.boolean(),
});
export type AgentVersion = z.infer<typeof AgentVersionSchema>;

export const KnowledgeDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["pdf", "url", "csv", "text"]),
  sizeLabel: z.string(),
  chunks: z.number(),
  status: z.enum(["indexed", "indexing", "failed"]),
  updatedAt: z.string(),
  agentId: z.string().nullable().optional(),
});
export type KnowledgeDoc = z.infer<typeof KnowledgeDocSchema>;

/* ── Calls (§4.1, §4.4) ─────────────────────────────────────────────────── */

export const LiveCallSchema = z.object({
  id: z.string(),
  phone: z.string(),
  customerName: z.string().optional(),
  agentId: z.string(),
  agentName: z.string(),
  intent: IntentSchema,
  language: LanguageSchema,
  direction: z.enum(["inbound", "outbound"]),
  startedAt: z.string(),
  sentiment: SentimentSchema,
  /** 0–1, scored per-utterance during the call, not post-call (§4.4). */
  sentimentScore: z.number(),
  transcriptPreview: z.string().optional(),
  source: z.enum(["phone", "browser"]).optional(),
});
export type LiveCall = z.infer<typeof LiveCallSchema>;

export const CallRecordSchema = z.object({
  id: z.string(),
  phone: z.string(),
  agentName: z.string(),
  intent: IntentSchema,
  language: LanguageSchema,
  direction: z.enum(["inbound", "outbound"]),
  startedAt: z.string(),
  durationSec: z.number(),
  outcome: z.enum(["resolved", "escalated", "no_answer", "dropped", "voicemail"]),
  sentiment: SentimentSchema,
  qaScore: z.number().nullable(),
  qaFlag: z.string().nullable(),
  costInr: z.number(),
});
export type CallRecord = z.infer<typeof CallRecordSchema>;

/* ── Campaigns (§4.3) ───────────────────────────────────────────────────── */

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  series: NumberSeriesSchema,
  contacts: z.number(),
  dialed: z.number(),
  connected: z.number(),
  connectRate: z.number(),
  status: z.enum(["running", "paused", "scheduled", "completed", "draft"]),
  scrubbedCount: z.number(),
  startsAt: z.string().nullable(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const ScrubStatusSchema = z.object({
  dltEntityApproved: z.boolean(),
  dltTemplatesApproved: z.number(),
  dltTemplatesPending: z.number(),
  dndSyncedAt: z.string(),
  dndExcluded: z.number(),
  quietHours: z.object({ from: z.string(), to: z.string() }),
  retryAttempts: z.number(),
  retryGapMinutes: z.number(),
});
export type ScrubStatus = z.infer<typeof ScrubStatusSchema>;

/* ── Bookings (§4.6) ────────────────────────────────────────────────────── */

export const BookingSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  phone: z.string(),
  type: z.string(),
  startsAt: z.string(),
  durationMin: z.number(),
  status: z.enum(["confirmed", "pending", "cancelled", "completed", "no_show"]),
  /** 0–1 heuristic from reschedule/cancellation history (§4.6). */
  noShowRisk: z.number(),
  source: z.enum(["call", "whatsapp", "manual", "web"]),
  reminderSent: z.boolean(),
});
export type Booking = z.infer<typeof BookingSchema>;

/* ── Complaints (§4.7) ──────────────────────────────────────────────────── */

export const ComplaintStageSchema = z.enum([
  "new",
  "in_progress",
  "escalated",
  "resolved",
]);
export type ComplaintStage = z.infer<typeof ComplaintStageSchema>;

export const ComplaintSchema = z.object({
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  category: z.string(),
  severity: SeveritySchema,
  stage: ComplaintStageSchema,
  customerName: z.string(),
  phone: z.string(),
  openedAt: z.string(),
  /** Absolute deadline; the countdown is derived client-side but the timer
   *  itself is a backend job (§4.7). */
  slaDueAt: z.string(),
  assignee: z.string().nullable(),
  callId: z.string().nullable(),
  /** Which department owns the follow-up. Assigned by the post-call pipeline
   *  (or keyword fallback); null only for complaints that predate routing. */
  department: z.string().nullable().optional(),
  hasRecording: z.boolean(),
  hasConsent: z.boolean(),
  kind: z.enum(["enquiry", "complaint", "grievance"]).optional(),
});
export type Complaint = z.infer<typeof ComplaintSchema>;

/* ── Departments & action queue ─────────────────────────────────────────── */

export const DepartmentSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  openActions: z.number(),
  keywords: z.array(z.string()).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
});
export type Department = z.infer<typeof DepartmentSchema>;

/** One unit of follow-up work produced by a call, in the department's terms.
 *  A complaint says "a caller is unhappy"; an action says "cleaning crew,
 *  platform 2, before 6pm". Department users work this queue. */
export const ActionItemSchema = z.object({
  id: z.string(),
  department: z.string(),
  departmentId: z.string(),
  callId: z.string().nullable(),
  complaintRef: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  severity: SeveritySchema,
  status: z.enum(["open", "in_progress", "done"]),
  createdAt: z.string(),
  dueAt: z.string().nullable(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

/* ── Auth ───────────────────────────────────────────────────────────────── */

export const SessionUserSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

/* ── Invoices ───────────────────────────────────────────────────────────── */

export const InvoiceSchema = z.object({
  id: z.string(),
  cycleStart: z.string(),
  cycleEnd: z.string(),
  plan: z.string(),
  planFeeInr: z.number(),
  overageMinutes: z.number(),
  overageInr: z.number(),
  totalInr: z.number(),
  status: z.enum(["due", "paid", "void"]),
  paidAt: z.string().nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/* ── Customer 360 (§4.8) ────────────────────────────────────────────────── */

export const TimelineEventSchema = z.object({
  id: z.string(),
  kind: z.enum(["call", "whatsapp", "sms", "email", "order", "booking", "complaint"]),
  title: z.string(),
  detail: z.string().optional(),
  at: z.string(),
  amountInr: z.number().optional(),
  sentiment: SentimentSchema.optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const CustomerSchema = z.object({
  /** Phone is the identity primary key across every channel (§4.8). */
  id: z.string(),
  phone: z.string(),
  name: z.string(),
  city: z.string(),
  preferredLanguage: LanguageSchema,
  orders: z.number(),
  lifetimeValueInr: z.number(),
  sentiment: SentimentSchema,
  since: z.string(),
  lastContactAt: z.string(),
  lastChannel: z.enum(["call", "whatsapp", "sms", "email"]),
  tags: z.array(z.string()),
  timeline: z.array(TimelineEventSchema),
});
export type Customer = z.infer<typeof CustomerSchema>;

/* ── Voice studio (§4.9) ────────────────────────────────────────────────── */

export const VoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: LanguageSchema,
  descriptor: z.string(),
  gender: z.enum(["female", "male", "neutral"]),
  assignedTo: z.string().nullable(),
  pace: z.number(),
  formality: z.number(),
  warmth: z.number(),
  latencyMs: z.number(),
  cloned: z.boolean(),
  liveName: z.string().optional(),
  style: z.string().optional(),
  personaName: z.string().optional(),
  promptTemplate: z.string().optional(),
  assignedAgentId: z.string().nullable().optional(),
});

export const TransferTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  phone: z.string(),
  hours: z.string(),
  whenToUse: z.string(),
  departmentId: z.string().nullable(),
  department: z.string().nullable(),
  email: z.string().optional(),
  whatsapp: z.string().optional(),
  priority: z.number(),
});
export type TransferTarget = z.infer<typeof TransferTargetSchema>;

export const AppointmentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMin: z.number(),
  hours: z.string(),
  days: z.array(z.string()),
  location: z.string(),
  bufferMin: z.number(),
  notes: z.string(),
});
export type AppointmentType = z.infer<typeof AppointmentTypeSchema>;

export const UseCaseSchema = z.enum([
  "clinic",
  "ecommerce",
  "customer_care",
  "sales",
  "civic",
  "hospitality",
  "education",
  "other",
]);
export type UseCase = z.infer<typeof UseCaseSchema>;

export const PlaybookSchema = z.object({
  orgId: z.string(),
  businessType: z.string(),
  hours: z.string(),
  transferPolicy: z.string(),
  bookingPolicy: z.string(),
  complaintSlaHours: z.number(),
  useCase: UseCaseSchema.default("other"),
  hasSales: z.boolean().default(false),
  humanEscalation: z.boolean().default(true),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const SetupStatusSchema = z.object({
  departments: z.number(),
  transfers: z.number(),
  appointmentTypes: z.number(),
  knowledge: z.number(),
  connectors: z.number(),
  voices: z.number(),
  agents: z.number().default(0),
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

/* ── Swara agent planner ─────────────────────────────────────────────────── */

export const PlannedAgentSchema = z.object({
  key: z.string(),
  name: z.string(),
  job: z.string(),
  intent: IntentSchema,
  direction: z.enum(["inbound", "outbound", "both"]),
  handsOffTo: z.array(z.string()).default([]),
  isFrontDoor: z.boolean().default(false),
  needs: z.array(z.string()).default([]),
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
  prompt: z.string(),
  /** Tools this agent is allowed to call. Empty means derive at apply time. */
  tools: z.array(z.string()).default([]),
  /** Facts ingested into this agent's own knowledge base on apply. */
  knowledge: z.string().default(""),
  /** First name the agent uses on the call. */
  personaName: z.string().default(""),
  /** Live API voice name ("Orus", "Kore"…). */
  voice: z.string().default(""),
});
export type PlannedAgent = z.infer<typeof PlannedAgentSchema>;

export const AgentPlanSchema = z.object({
  brief: z.string(),
  summary: z.string(),
  /** Things Swara still wants to know before building. Empty = ready. */
  questions: z.array(z.string()).default([]),
  /** Setup gaps the plan depends on (e.g. "no transfer desk"). */
  gaps: z.array(z.string()).default([]),
  agents: z.array(PlannedAgentSchema),
  source: z.enum(["gemini", "heuristic"]),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const SwaraChatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  text: z.string(),
});
export const SwaraChatResponseSchema = z.object({
  reply: z.string(),
  tools: z.array(z.object({ name: z.string(), result: z.record(z.string(), z.unknown()) })),
  plan: AgentPlanSchema.nullable(),
  model: z.string(),
});
export type SwaraChatResponse = z.infer<typeof SwaraChatResponseSchema>;

export const ConnectorRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  tool: z.string(),
  baseUrl: z.string(),
  authHeader: z.string(),
  status: z.string(),
  hasSecret: z.boolean(),
});

export const CampaignContactSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  phone: z.string(),
  name: z.string(),
  language: z.string(),
  dnd: z.boolean(),
  status: z.string(),
  lastAttemptAt: z.string().nullable(),
});
export type CampaignContact = z.infer<typeof CampaignContactSchema>;

export const AgentTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  blurb: z.string(),
  intent: IntentSchema,
  direction: z.enum(["inbound", "outbound", "both"]),
  needs: z.array(z.string()),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const ScriptTestSchema = z.object({
  id: z.string(),
  agentName: z.string(),
  hypothesis: z.string(),
  variantA: z.object({ script: z.string(), calls: z.number(), resolveRate: z.number() }),
  variantB: z.object({ script: z.string(), calls: z.number(), resolveRate: z.number() }),
  /** Null until the sample is large enough to call it. */
  winner: z.enum(["A", "B"]).nullable(),
  confidence: z.number(),
});
export type ScriptTest = z.infer<typeof ScriptTestSchema>;

/* ── Numbers & SIP (§4.10) ──────────────────────────────────────────────── */

export const PhoneNumberSchema = z.object({
  id: z.string(),
  e164: z.string(),
  series: NumberSeriesSchema,
  provider: z.string(),
  region: z.string(),
  assignedAgentId: z.string().nullable(),
  assignedAgentName: z.string().nullable(),
  pickupRate: z.number(),
  callsToday: z.number(),
  monthlyRentInr: z.number(),
  status: z.enum(["active", "provisioning", "suspended"]),
});
export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;

export const SecuritySettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** Some of these are the telephony partner's capability, not ours — the UI
   *  must say so rather than implying we built it (§4.10). */
  provider: z.enum(["swara", "partner"]),
  availability: z.enum(["available", "beta", "roadmap"]),
});
export type SecuritySetting = z.infer<typeof SecuritySettingSchema>;

export const SipTrunkSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  channels: z.number(),
  channelsInUse: z.number(),
  status: z.enum(["healthy", "degraded", "down"]),
  latencyMs: z.number(),
  asr: z.number(),
});
export type SipTrunk = z.infer<typeof SipTrunkSchema>;

/* ── Integrations (§4.11) ───────────────────────────────────────────────── */

export const IntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["crm", "ecommerce", "logistics", "messaging", "calendar", "developer", "ops"]),
  blurb: z.string(),
  status: z.enum(["connected", "available", "coming_soon"]),
  /** Indian-first ordering for the e-commerce/delivery wedge (§4.11). */
  priority: z.number(),
  accent: z.enum(["violet", "cyan", "amber", "coral"]),
  connectedAt: z.string().nullable(),
  detail: z.string().nullable(),
});
export type Integration = z.infer<typeof IntegrationSchema>;

/* ── Settings / billing / compliance (§4.12, §2) ────────────────────────── */

export const UsageSchema = z.object({
  plan: z.enum(["starter", "growth", "scale"]),
  planLabel: z.string(),
  planPriceInr: z.number(),
  includedMinutes: z.number(),
  usedMinutes: z.number(),
  overageRateInr: z.number(),
  cycleStart: z.string(),
  cycleEnd: z.string(),
  /** Measured, not assumed. §2 requires real metering from the first cycle. */
  aiCostInr: z.number(),
  telephonyCostInr: z.number(),
  /** No projected total here on purpose — the console derives it from the
   *  cycle window so the forecast and the invoice can never disagree. */
  dailyMinutes: z.array(z.object({ date: z.string(), minutes: z.number() })),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ComplianceItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  status: z.enum(["approved", "active", "review", "pending", "blocked"]),
  detail: z.string(),
  checkedAt: z.string(),
  /** True when we poll the authority/provider; false means a human set it and
   *  it can go stale silently — the UI surfaces that difference (§4.12). */
  automated: z.boolean(),
});
export type ComplianceItem = z.infer<typeof ComplianceItemSchema>;

export const TeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "supervisor", "agent", "analyst", "billing"]),
  status: z.enum(["active", "invited", "suspended"]),
  lastActiveAt: z.string(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const ApiKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

/* ── Dashboard & analytics (§4.1, §4.5) ─────────────────────────────────── */

export const OverviewSchema = z.object({
  callsToday: z.number(),
  callsTodayDelta: z.number(),
  minutesUsed: z.number(),
  minutesDelta: z.number(),
  resolutionRate: z.number(),
  resolutionDelta: z.number(),
  openComplaints: z.number(),
  complaintsDelta: z.number(),
  /** Open tickets whose SLA clock has already run out. */
  pastSla: z.number().default(0),
  activeCalls: z.number(),
  volume: z.array(
    z.object({ date: z.string(), inbound: z.number(), outbound: z.number() }),
  ),
  languageMix: z.array(z.object({ language: LanguageSchema, share: z.number() })),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const AnalyticsSchema = z.object({
  avgHandleSec: z.number(),
  containmentRate: z.number(),
  escalationRate: z.number(),
  csat: z.number(),
  costPerCallInr: z.number(),
  deltas: z.object({
    avgHandleSec: z.number(),
    containmentRate: z.number(),
    escalationRate: z.number(),
    csat: z.number(),
    costPerCallInr: z.number(),
  }),
  csatTrend: z.array(z.object({ date: z.string(), value: z.number() })),
  costTrend: z.array(z.object({ date: z.string(), ai: z.number(), telephony: z.number() })),
  outcomeMix: z.array(z.object({ outcome: z.string(), count: z.number() })),
  scoredCalls: z.array(CallRecordSchema),
});
export type Analytics = z.infer<typeof AnalyticsSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(["complaint", "compliance", "billing", "system", "campaign"]),
  title: z.string(),
  body: z.string(),
  at: z.string(),
  severity: SeveritySchema,
  read: z.boolean(),
  href: z.string().nullable(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;
