import type {
  ActionItem,
  Agent,
  AgentVersion,
  Analytics,
  AppNotification,
  ApiKey,
  Booking,
  CallRecord,
  Campaign,
  ComplianceItem,
  Complaint,
  Customer,
  Department,
  Integration,
  Invoice,
  KnowledgeDoc,
  LiveCall,
  Overview,
  PhoneNumber,
  ScriptTest,
  ScrubStatus,
  SecuritySetting,
  SessionUser,
  SipTrunk,
  TeamMember,
  Usage,
  Voice,
} from "./schemas";

/**
 * Demo dataset for the mock adapter.
 *
 * Deliberately modelled on the first target segment from project.md §1 —
 * an Indian D2C/quick-delivery business — so the console can be shown to a
 * real prospect without explaining away placeholder data.
 */

/** Seeded PRNG so every render/reload produces the same "random" shape. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260904);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

const isoDay = (offsetDays: number) => {
  const d = new Date(Date.now() - offsetDays * DAY);
  return d.toISOString().slice(0, 10);
};

/* ── Agents ─────────────────────────────────────────────────────────────── */

const deliveryRescheduleFlow: Pick<Agent, "nodes" | "edges"> = {
  nodes: [
    {
      id: "n1",
      kind: "start",
      title: "Greeting + language detect",
      detail: "Auto-detects Hindi / Tamil / English from first utterance",
      x: 40,
      y: 40,
      config: { detectWithinMs: 1200, fallbackLanguage: "hinglish" },
    },
    {
      id: "n2",
      kind: "intent",
      title: "Identify reason for call",
      detail: "6 intents · 94% top-1 accuracy",
      x: 300,
      y: 40,
      config: {},
    },
    {
      id: "n3",
      kind: "data_pull",
      title: "Fetch live order status",
      detail: "Shiprocket · 240ms p95",
      x: 40,
      y: 190,
      config: { integration: "shiprocket", timeoutMs: 900 },
    },
    {
      id: "n4",
      kind: "branch",
      title: "Reschedule / cancel / confirm",
      detail: "3 branches",
      x: 300,
      y: 300,
      config: {},
    },
    {
      id: "n5",
      kind: "book",
      title: "Commit new delivery slot",
      detail: "Concurrency-safe hold, then confirm",
      x: 560,
      y: 240,
      config: { calendar: "google", holdSeconds: 45 },
    },
    {
      id: "n6",
      kind: "escalate",
      title: "Transfer to human + context",
      detail: "Warm transfer with transcript summary",
      x: 560,
      y: 390,
      config: { queue: "support_l2", passContext: true },
    },
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2", tone: "default" },
    { id: "e2", from: "n2", to: "n3", label: "order-related", tone: "default" },
    { id: "e3", from: "n3", to: "n4", tone: "default" },
    { id: "e4", from: "n4", to: "n5", label: "reschedule", tone: "success" },
    { id: "e5", from: "n4", to: "n6", label: "unresolved", tone: "danger" },
  ],
};

export const agents: Agent[] = [
  {
    id: "ag_delivery",
    name: "Delivery reschedule",
    status: "live",
    languages: ["hi", "ta", "en"],
    intent: "delivery_reschedule",
    direction: "both",
    voiceId: "v_ananya",
    mode: "graph",
    version: 12,
    callsToday: 842,
    resolutionRate: 0.93,
    updatedAt: ago(2 * MINUTE),
    ...deliveryRescheduleFlow,
  },
  {
    id: "ag_order",
    name: "Order status lookup",
    status: "live",
    languages: ["hi", "en", "hinglish", "ta", "te"],
    intent: "order_status",
    direction: "inbound",
    voiceId: "v_ananya",
    mode: "prompt",
    prompt:
      "You are Swara, the support voice for a quick-commerce brand. Greet in the caller's language. Look up their most recent order with the order_status tool before answering. Never invent a delivery date — if the tool fails, apologise and offer a callback.",
    version: 8,
    callsToday: 1204,
    resolutionRate: 0.96,
    updatedAt: ago(3 * HOUR),
    nodes: [],
    edges: [],
  },
  {
    id: "ag_lead",
    name: "Lead qualification",
    status: "draft",
    languages: ["hinglish"],
    intent: "sales_enquiry",
    direction: "outbound",
    voiceId: "v_karthik",
    mode: "graph",
    version: 3,
    callsToday: 0,
    resolutionRate: 0,
    updatedAt: ago(2 * DAY),
    nodes: [],
    edges: [],
  },
  {
    id: "ag_grievance",
    name: "Grievance intake",
    status: "live",
    languages: ["hi", "en", "ta", "te", "kn", "ml", "mr", "bn"],
    intent: "complaint",
    direction: "inbound",
    voiceId: "v_meera",
    mode: "graph",
    version: 21,
    callsToday: 318,
    resolutionRate: 0.81,
    updatedAt: ago(6 * HOUR),
    nodes: [],
    edges: [],
  },
  {
    id: "ag_booking",
    name: "Appointment booking",
    status: "testing",
    languages: ["en", "hi"],
    intent: "booking",
    direction: "both",
    voiceId: "v_ananya",
    mode: "graph",
    version: 5,
    callsToday: 47,
    resolutionRate: 0.88,
    updatedAt: ago(40 * MINUTE),
    nodes: [],
    edges: [],
  },
  {
    id: "ag_cod",
    name: "COD payment reminder",
    status: "live",
    languages: ["hi", "hinglish", "mr"],
    intent: "payment_reminder",
    direction: "outbound",
    voiceId: "v_karthik",
    mode: "prompt",
    prompt:
      "Remind the customer about a pending cash-on-delivery amount politely. State the amount and order id once. Offer a prepaid payment link over SMS. Do not call before 9am or after 9pm.",
    version: 6,
    callsToday: 436,
    resolutionRate: 0.74,
    updatedAt: ago(1 * DAY),
    nodes: [],
    edges: [],
  },
];

export const agentVersions: AgentVersion[] = [
  { id: "vr12", version: 12, label: "Added Tamil greeting variant", author: "Copilot", createdAt: ago(2 * MINUTE), isLive: true },
  { id: "vr11", version: 11, label: "Address spelling confirmation", author: "Rohan S", createdAt: ago(5 * HOUR), isLive: false },
  { id: "vr10", version: 10, label: "Shiprocket timeout 900ms", author: "Rohan S", createdAt: ago(2 * DAY), isLive: false },
  { id: "vr9", version: 9, label: "Escalation queue → support_l2", author: "Copilot", createdAt: ago(4 * DAY), isLive: false },
];

export const knowledgeDocs: KnowledgeDoc[] = [
  { id: "kd1", name: "Returns & refunds policy.pdf", kind: "pdf", sizeLabel: "412 KB", chunks: 84, status: "indexed", updatedAt: ago(3 * DAY) },
  { id: "kd2", name: "help.brandname.in/delivery", kind: "url", sizeLabel: "38 pages", chunks: 216, status: "indexed", updatedAt: ago(1 * DAY) },
  { id: "kd3", name: "Serviceable pincodes.csv", kind: "csv", sizeLabel: "1.2 MB", chunks: 19400, status: "indexed", updatedAt: ago(8 * HOUR) },
  { id: "kd4", name: "Festive offer terms.pdf", kind: "pdf", sizeLabel: "96 KB", chunks: 12, status: "indexing", updatedAt: ago(4 * MINUTE) },
];

/* ── Live calls ─────────────────────────────────────────────────────────── */

export const liveCalls: LiveCall[] = [
  {
    id: "lc1",
    phone: "+919876542214",
    customerName: "Priya Menon",
    agentId: "ag_delivery",
    agentName: "Delivery reschedule",
    intent: "delivery_reschedule",
    language: "hi",
    direction: "inbound",
    startedAt: ago(84_000),
    sentiment: "positive",
    sentimentScore: 0.82,
    transcriptPreview: "…kal shaam 6 baje tak ho jayega, main slot update kar deti hoon.",
  },
  {
    id: "lc2",
    phone: "+918765430091",
    customerName: "Arjun Patel",
    agentId: "ag_grievance",
    agentName: "Grievance intake",
    intent: "complaint",
    language: "ta",
    direction: "inbound",
    startedAt: ago(192_000),
    sentiment: "frustrated",
    sentimentScore: 0.18,
    transcriptPreview: "…மூன்றாவது முறையா இப்படி ஆகுது, எனக்கு refund வேணும்.",
  },
  {
    id: "lc3",
    phone: "+919012345527",
    customerName: "Neha Sharma",
    agentId: "ag_lead",
    agentName: "Lead qualification",
    intent: "sales_enquiry",
    language: "hinglish",
    direction: "outbound",
    startedAt: ago(123_000),
    sentiment: "neutral",
    sentimentScore: 0.58,
    transcriptPreview: "…so the Growth plan gives you 6,000 minutes, shall I send details?",
  },
  {
    id: "lc4",
    phone: "+917788112233",
    customerName: "Vikram Iyer",
    agentId: "ag_order",
    agentName: "Order status lookup",
    intent: "order_status",
    language: "en",
    direction: "inbound",
    startedAt: ago(41_000),
    sentiment: "neutral",
    sentimentScore: 0.61,
    transcriptPreview: "…your order is out for delivery, arriving between 4 and 6pm.",
  },
  {
    id: "lc5",
    phone: "+919445566778",
    customerName: "Sana Qureshi",
    agentId: "ag_cod",
    agentName: "COD payment reminder",
    intent: "payment_reminder",
    language: "mr",
    direction: "outbound",
    startedAt: ago(66_000),
    sentiment: "declining",
    sentimentScore: 0.34,
    transcriptPreview: "…मी आधीच पैसे भरले आहेत, परत का विचारताय?",
  },
  {
    id: "lc6",
    phone: "+918899001122",
    customerName: "Rahul Nair",
    agentId: "ag_delivery",
    agentName: "Delivery reschedule",
    intent: "delivery_reschedule",
    language: "ml",
    direction: "inbound",
    startedAt: ago(28_000),
    sentiment: "positive",
    sentimentScore: 0.77,
    transcriptPreview: "…നാളെ രാവിലെ ആയാൽ കുഴപ്പമില്ല.",
  },
];

/* ── Overview ───────────────────────────────────────────────────────────── */

export const overview: Overview = {
  callsToday: 2847,
  callsTodayDelta: 0.18,
  minutesUsed: 4120,
  minutesDelta: 0.06,
  resolutionRate: 0.914,
  resolutionDelta: 0.021,
  openComplaints: 6,
  complaintsDelta: -3,
  pastSla: 1,
  activeCalls: liveCalls.length,
  volume: Array.from({ length: 7 }, (_, i) => {
    const d = 6 - i;
    return {
      date: isoDay(d),
      inbound: Math.round(900 + rand() * 700),
      outbound: Math.round(500 + rand() * 900),
    };
  }),
  languageMix: [
    { language: "hi", share: 0.38 },
    { language: "hinglish", share: 0.21 },
    { language: "en", share: 0.16 },
    { language: "ta", share: 0.11 },
    { language: "te", share: 0.07 },
    { language: "mr", share: 0.07 },
  ],
};

/* ── Campaigns ──────────────────────────────────────────────────────────── */

export const campaigns: Campaign[] = [
  { id: "cp1", name: "Diwali sale outreach", agentId: "ag_lead", agentName: "Lead qualification", series: "140", contacts: 6200, dialed: 4310, connected: 1767, connectRate: 0.41, status: "running", scrubbedCount: 188, startsAt: ago(2 * DAY) },
  { id: "cp2", name: "COD payment reminders", agentId: "ag_cod", agentName: "COD payment reminder", series: "160", contacts: 2850, dialed: 2850, connected: 1624, connectRate: 0.57, status: "running", scrubbedCount: 0, startsAt: ago(5 * HOUR) },
  { id: "cp3", name: "Delivery failure follow-up", agentId: "ag_delivery", agentName: "Delivery reschedule", series: "160", contacts: 1940, dialed: 1180, connected: 389, connectRate: 0.33, status: "paused", scrubbedCount: 0, startsAt: ago(1 * DAY) },
  { id: "cp4", name: "Post-delivery CSAT survey", agentId: "ag_booking", agentName: "Feedback agent", series: "160", contacts: 1420, dialed: 0, connected: 0, connectRate: 0, status: "scheduled", scrubbedCount: 0, startsAt: ahead(18 * HOUR) },
  { id: "cp5", name: "Win-back — lapsed 60 days", agentId: "ag_lead", agentName: "Lead qualification", series: "140", contacts: 8800, dialed: 0, connected: 0, connectRate: 0, status: "draft", scrubbedCount: 124, startsAt: null },
];

export const scrubStatus: ScrubStatus = {
  dltEntityApproved: true,
  dltTemplatesApproved: 14,
  dltTemplatesPending: 2,
  dndSyncedAt: ago(4 * HOUR),
  dndExcluded: 312,
  quietHours: { from: "21:00", to: "09:00" },
  retryAttempts: 3,
  retryGapMinutes: 45,
};

/* ── Bookings ───────────────────────────────────────────────────────────── */

export const bookings: Booking[] = [
  { id: "bk1", customerName: "Priya Menon", phone: "+919876542214", type: "Home delivery slot", startsAt: ahead(2 * HOUR), durationMin: 60, status: "confirmed", noShowRisk: 0.08, source: "call", reminderSent: true },
  { id: "bk2", customerName: "Arjun Patel", phone: "+918765430091", type: "Install appointment", startsAt: ahead(3.5 * HOUR), durationMin: 90, status: "confirmed", noShowRisk: 0.34, source: "call", reminderSent: false },
  { id: "bk3", customerName: "Neha Sharma", phone: "+919012345527", type: "Return pickup", startsAt: ahead(5 * HOUR), durationMin: 30, status: "pending", noShowRisk: 0.12, source: "whatsapp", reminderSent: false },
  { id: "bk4", customerName: "Vikram Iyer", phone: "+917788112233", type: "Demo call", startsAt: ahead(1 * DAY), durationMin: 30, status: "confirmed", noShowRisk: 0.52, source: "web", reminderSent: false },
  { id: "bk5", customerName: "Sana Qureshi", phone: "+919445566778", type: "Home delivery slot", startsAt: ahead(1.2 * DAY), durationMin: 60, status: "confirmed", noShowRisk: 0.19, source: "call", reminderSent: true },
  { id: "bk6", customerName: "Rahul Nair", phone: "+918899001122", type: "Service visit", startsAt: ahead(2 * DAY), durationMin: 120, status: "pending", noShowRisk: 0.41, source: "call", reminderSent: false },
  { id: "bk7", customerName: "Divya Rao", phone: "+919900112233", type: "Return pickup", startsAt: ahead(2.4 * DAY), durationMin: 30, status: "confirmed", noShowRisk: 0.07, source: "manual", reminderSent: true },
  { id: "bk8", customerName: "Imran Shaikh", phone: "+919812345678", type: "Install appointment", startsAt: ahead(3 * DAY), durationMin: 90, status: "confirmed", noShowRisk: 0.28, source: "call", reminderSent: false },
];

/* ── Complaints ─────────────────────────────────────────────────────────── */

export const complaints: Complaint[] = [
  { id: "c1", ref: "#48213", title: "Wrong item delivered, refund requested", category: "Wrong item", severity: "high", stage: "new", customerName: "Priya Menon", phone: "+919876542214", openedAt: ago(22 * MINUTE), slaDueAt: ahead(3.6 * HOUR), assignee: null, callId: "48213", hasRecording: true, hasConsent: true },
  { id: "c2", ref: "#48209", title: "Late delivery, third occurrence", category: "Delay", severity: "medium", stage: "new", customerName: "Arjun Patel", phone: "+918765430091", openedAt: ago(1.4 * HOUR), slaDueAt: ahead(6.6 * HOUR), assignee: null, callId: "48209", hasRecording: true, hasConsent: true },
  { id: "c3", ref: "#48206", title: "Agent could not understand Marathi", category: "Experience", severity: "low", stage: "new", customerName: "Sana Qureshi", phone: "+919445566778", openedAt: ago(2.2 * HOUR), slaDueAt: ahead(21 * HOUR), assignee: null, callId: "48206", hasRecording: true, hasConsent: true },
  { id: "c4", ref: "#48190", title: "Repeat caller, same order unresolved", category: "Repeat contact", severity: "medium", stage: "in_progress", customerName: "Vikram Iyer", phone: "+917788112233", openedAt: ago(5 * HOUR), slaDueAt: ahead(2.9 * HOUR), assignee: "Rohan S", callId: "48190", hasRecording: true, hasConsent: true },
  { id: "c5", ref: "#48177", title: "Pincode not serviceable after order placed", category: "Serviceability", severity: "medium", stage: "in_progress", customerName: "Divya Rao", phone: "+919900112233", openedAt: ago(9 * HOUR), slaDueAt: ahead(48 * MINUTE), assignee: "Rohan S", callId: "48177", hasRecording: true, hasConsent: true },
  { id: "c6", ref: "#48150", title: "Damaged product, video proof shared", category: "Damage", severity: "critical", stage: "escalated", customerName: "Imran Shaikh", phone: "+919812345678", openedAt: ago(1.2 * DAY), slaDueAt: ago(35 * MINUTE), assignee: "Rohan S", callId: "48150", hasRecording: true, hasConsent: true },
  { id: "c7", ref: "#48141", title: "Charged twice for one order", category: "Billing", severity: "high", stage: "escalated", customerName: "Rahul Nair", phone: "+918899001122", openedAt: ago(1.6 * DAY), slaDueAt: ahead(4 * HOUR), assignee: "Rohan S", callId: "48141", hasRecording: true, hasConsent: false },
  { id: "c8", ref: "#48122", title: "Refund processed and confirmed", category: "Billing", severity: "medium", stage: "resolved", customerName: "Neha Sharma", phone: "+919012345527", openedAt: ago(3 * DAY), slaDueAt: ago(2.6 * DAY), assignee: "Rohan S", callId: "48122", hasRecording: true, hasConsent: true },
  { id: "c9", ref: "#48119", title: "Reschedule confirmed by customer", category: "Delay", severity: "low", stage: "resolved", customerName: "Priya Menon", phone: "+919876542214", openedAt: ago(3.4 * DAY), slaDueAt: ago(3 * DAY), assignee: "Copilot", callId: "48119", hasRecording: true, hasConsent: true },
  { id: "c10", ref: "#48101", title: "Missing invoice for GST claim", category: "Billing", severity: "low", stage: "resolved", customerName: "Vikram Iyer", phone: "+917788112233", openedAt: ago(4 * DAY), slaDueAt: ago(3.5 * DAY), assignee: "Rohan S", callId: "48101", hasRecording: false, hasConsent: true },
];

/* ── Customers ──────────────────────────────────────────────────────────── */

export const customers: Customer[] = [
  {
    id: "cu1",
    phone: "+919876542214",
    name: "Priya Menon",
    city: "Kochi",
    preferredLanguage: "hi",
    orders: 7,
    lifetimeValueInr: 18420,
    sentiment: "positive",
    since: "2026-02-11",
    lastContactAt: ago(12 * MINUTE),
    lastChannel: "call",
    tags: ["repeat buyer", "prepaid"],
    timeline: [
      { id: "t1", kind: "call", title: "Call — delivery reschedule agreed", detail: "Hindi · 2m 14s · resolved by agent", at: ago(12 * MINUTE), sentiment: "positive" },
      { id: "t2", kind: "whatsapp", title: "WhatsApp — delivery delay notice sent", detail: "Delivered, read", at: ago(3 * HOUR) },
      { id: "t3", kind: "order", title: "Order #48213 placed", detail: "2 items · prepaid", at: ago(1 * DAY), amountInr: 2340 },
      { id: "t4", kind: "call", title: "Call — order status enquiry", detail: "Hindi · 1m 02s · resolved by agent", at: ago(3 * DAY), sentiment: "neutral" },
      { id: "t5", kind: "complaint", title: "Complaint #48119 — late delivery", detail: "Resolved in 4h 12m", at: ago(3.4 * DAY) },
      { id: "t6", kind: "order", title: "Order #47980 placed", detail: "1 item · prepaid", at: ago(9 * DAY), amountInr: 1180 },
    ],
  },
  {
    id: "cu2",
    phone: "+918765430091",
    name: "Arjun Patel",
    city: "Ahmedabad",
    preferredLanguage: "ta",
    orders: 3,
    lifetimeValueInr: 6240,
    sentiment: "frustrated",
    since: "2026-05-02",
    lastContactAt: ago(40 * MINUTE),
    lastChannel: "whatsapp",
    tags: ["at risk", "COD"],
    timeline: [
      { id: "t1", kind: "call", title: "Call — complaint, third late delivery", detail: "Tamil · 3m 12s · escalated", at: ago(40 * MINUTE), sentiment: "frustrated" },
      { id: "t2", kind: "complaint", title: "Complaint #48209 opened", detail: "Severity: medium · SLA 8h", at: ago(1.4 * HOUR) },
      { id: "t3", kind: "order", title: "Order #48209 placed", detail: "3 items · COD", at: ago(4 * DAY), amountInr: 3120 },
    ],
  },
  {
    id: "cu3",
    phone: "+919012345527",
    name: "Neha Sharma",
    city: "Jaipur",
    preferredLanguage: "hinglish",
    orders: 12,
    lifetimeValueInr: 41200,
    sentiment: "positive",
    since: "2025-11-19",
    lastContactAt: ago(1 * HOUR),
    lastChannel: "sms",
    tags: ["VIP", "prepaid"],
    timeline: [
      { id: "t1", kind: "sms", title: "SMS — return pickup scheduled", at: ago(1 * HOUR) },
      { id: "t2", kind: "booking", title: "Booking — return pickup 5:00pm", at: ago(1.1 * HOUR) },
      { id: "t3", kind: "order", title: "Order #48180 placed", detail: "5 items · prepaid", at: ago(2 * DAY), amountInr: 7890 },
    ],
  },
  {
    id: "cu4",
    phone: "+917788112233",
    name: "Vikram Iyer",
    city: "Chennai",
    preferredLanguage: "en",
    orders: 5,
    lifetimeValueInr: 12980,
    sentiment: "neutral",
    since: "2026-01-08",
    lastContactAt: ago(2 * HOUR),
    lastChannel: "call",
    tags: ["repeat buyer"],
    timeline: [
      { id: "t1", kind: "call", title: "Call — order status enquiry", detail: "English · 0m 51s · resolved by agent", at: ago(2 * HOUR), sentiment: "neutral" },
      { id: "t2", kind: "order", title: "Order #48166 placed", detail: "1 item · prepaid", at: ago(3 * DAY), amountInr: 4560 },
    ],
  },
  {
    id: "cu5",
    phone: "+919445566778",
    name: "Sana Qureshi",
    city: "Pune",
    preferredLanguage: "mr",
    orders: 2,
    lifetimeValueInr: 3100,
    sentiment: "declining",
    since: "2026-07-21",
    lastContactAt: ago(66_000),
    lastChannel: "call",
    tags: ["COD", "disputed payment"],
    timeline: [
      { id: "t1", kind: "call", title: "Call — COD reminder disputed", detail: "Marathi · in progress", at: ago(66_000), sentiment: "declining" },
      { id: "t2", kind: "order", title: "Order #48144 placed", detail: "2 items · COD", at: ago(6 * DAY), amountInr: 1550 },
    ],
  },
];

/* ── Voice studio ───────────────────────────────────────────────────────── */

export const voices: Voice[] = [
  { id: "v_ananya", name: "Ananya", language: "hi", descriptor: "warm, unhurried", gender: "female", assignedTo: "Delivery reschedule", pace: 0.55, formality: 0.45, warmth: 0.78, latencyMs: 310, cloned: false },
  { id: "v_karthik", name: "Karthik", language: "ta", descriptor: "brisk, confident", gender: "male", assignedTo: "Lead qualification", pace: 0.72, formality: 0.4, warmth: 0.52, latencyMs: 295, cloned: false },
  { id: "v_meera", name: "Meera", language: "hinglish", descriptor: "calm, patient", gender: "female", assignedTo: "Grievance intake", pace: 0.35, formality: 0.6, warmth: 0.88, latencyMs: 288, cloned: false },
  { id: "v_arnav", name: "Arnav", language: "en", descriptor: "neutral, professional", gender: "male", assignedTo: "Order status lookup", pace: 0.5, formality: 0.75, warmth: 0.5, latencyMs: 271, cloned: false },
  { id: "v_founder", name: "Rohan (cloned)", language: "hinglish", descriptor: "founder voice, 40s of audio", gender: "male", assignedTo: null, pace: 0.5, formality: 0.35, warmth: 0.66, latencyMs: 334, cloned: true },
  { id: "v_lakshmi", name: "Lakshmi", language: "te", descriptor: "bright, friendly", gender: "female", assignedTo: null, pace: 0.6, formality: 0.42, warmth: 0.71, latencyMs: 302, cloned: false },
];

export const scriptTests: ScriptTest[] = [
  {
    id: "st1",
    agentName: "Delivery reschedule",
    hypothesis: "Using the customer's first name in the greeting lifts resolve rate",
    variantA: { script: "Namaste, calling about your delivery today.", calls: 1240, resolveRate: 0.74 },
    variantB: { script: "Hi Priya, quick update on today's delivery.", calls: 1198, resolveRate: 0.89 },
    winner: "B",
    confidence: 0.98,
  },
  {
    id: "st2",
    agentName: "COD payment reminder",
    hypothesis: "Leading with the payment link beats leading with the amount",
    variantA: { script: "You have ₹1,550 pending on order #48144.", calls: 410, resolveRate: 0.61 },
    variantB: { script: "I can send you a payment link for order #48144 right now.", calls: 402, resolveRate: 0.66 },
    winner: null,
    confidence: 0.71,
  },
];

/* ── Numbers & SIP ──────────────────────────────────────────────────────── */

export const phoneNumbers: PhoneNumber[] = [
  { id: "pn1", e164: "+917972411020", series: "140", provider: "Plivo", region: "Maharashtra", assignedAgentId: "ag_lead", assignedAgentName: "Lead qualification", pickupRate: 0.76, callsToday: 612, monthlyRentInr: 499, status: "active" },
  { id: "pn2", e164: "+919204088341", series: "160", provider: "Exotel", region: "Karnataka", assignedAgentId: "ag_order", assignedAgentName: "Order status lookup", pickupRate: 0.81, callsToday: 1204, monthlyRentInr: 649, status: "active" },
  { id: "pn3", e164: "+918800277451", series: "160", provider: "Exotel", region: "Delhi NCR", assignedAgentId: "ag_grievance", assignedAgentName: "Grievance intake", pickupRate: 0.79, callsToday: 318, monthlyRentInr: 649, status: "active" },
  { id: "pn4", e164: "+919513366720", series: "160", provider: "Plivo", region: "Tamil Nadu", assignedAgentId: "ag_delivery", assignedAgentName: "Delivery reschedule", pickupRate: 0.84, callsToday: 842, monthlyRentInr: 649, status: "active" },
  { id: "pn5", e164: "+917400119088", series: "140", provider: "Vobiz", region: "Gujarat", assignedAgentId: null, assignedAgentName: null, pickupRate: 0, callsToday: 0, monthlyRentInr: 499, status: "provisioning" },
];

export const securitySettings: SecuritySetting[] = [
  { key: "stir_shaken", label: "STIR/SHAKEN attestation", description: "Caller-ID attestation is signed by the telephony partner on every outbound leg.", enabled: true, provider: "partner", availability: "available" },
  { key: "spam_detect", label: "Spam / robocall pattern detection", description: "Flags our own numbers when carriers start marking them as spam, before pickup rate collapses.", enabled: true, provider: "swara", availability: "available" },
  { key: "auto_block", label: "Auto-block reported numbers", description: "Numbers a customer reports are blocked across every campaign, not just the one that called.", enabled: false, provider: "swara", availability: "available" },
  { key: "voice_biometric", label: "Voice biometric caller verification", description: "Matches a returning caller against an enrolled voiceprint before disclosing order details.", enabled: false, provider: "swara", availability: "roadmap" },
];

export const sipTrunks: SipTrunk[] = [
  { id: "tr1", name: "Primary — Plivo Mumbai", host: "sip.mum1.plivo.swara.internal", channels: 240, channelsInUse: 96, status: "healthy", latencyMs: 42, asr: 0.71 },
  { id: "tr2", name: "Secondary — Exotel Bengaluru", host: "sip.blr1.exotel.swara.internal", channels: 180, channelsInUse: 61, status: "healthy", latencyMs: 51, asr: 0.68 },
  { id: "tr3", name: "Overflow — Vobiz Delhi", host: "sip.del1.vobiz.swara.internal", channels: 120, channelsInUse: 8, status: "degraded", latencyMs: 118, asr: 0.44 },
];

/* ── Integrations ───────────────────────────────────────────────────────── */

export const integrations: Integration[] = [
  { id: "shiprocket", name: "Shiprocket", category: "logistics", blurb: "Live shipment tracking mid-call", status: "connected", priority: 1, accent: "cyan", connectedAt: ago(20 * DAY), detail: "18,400 lookups this month" },
  { id: "zoho", name: "Zoho CRM", category: "crm", blurb: "Sync leads and call outcomes", status: "connected", priority: 2, accent: "violet", connectedAt: ago(31 * DAY), detail: "Two-way sync" },
  { id: "shopify", name: "Shopify", category: "ecommerce", blurb: "Orders, refunds, customer records", status: "connected", priority: 3, accent: "cyan", connectedAt: ago(28 * DAY), detail: "1 store" },
  { id: "whatsapp", name: "WhatsApp Business", category: "messaging", blurb: "Follow-up messages and payment links", status: "connected", priority: 4, accent: "cyan", connectedAt: ago(12 * DAY), detail: "Template-approved" },
  { id: "gcal", name: "Google Calendar", category: "calendar", blurb: "Real availability during a live call", status: "connected", priority: 5, accent: "amber", connectedAt: ago(9 * DAY), detail: "2 calendars" },
  { id: "webhooks", name: "Webhooks", category: "developer", blurb: "Push call events to your stack", status: "connected", priority: 6, accent: "violet", connectedAt: ago(30 * DAY), detail: "3 endpoints active" },
  { id: "restapi", name: "REST API", category: "developer", blurb: "Full programmatic control", status: "connected", priority: 7, accent: "violet", connectedAt: ago(30 * DAY), detail: "2 keys active" },
  { id: "unicommerce", name: "Unicommerce", category: "ecommerce", blurb: "Order management for Indian D2C", status: "available", priority: 8, accent: "cyan", connectedAt: null, detail: null },
  { id: "delhivery", name: "Delhivery", category: "logistics", blurb: "Shipment status and NDR handling", status: "available", priority: 9, accent: "cyan", connectedAt: null, detail: null },
  { id: "woocommerce", name: "WooCommerce", category: "ecommerce", blurb: "Orders and customers from WordPress", status: "available", priority: 10, accent: "violet", connectedAt: null, detail: null },
  { id: "hubspot", name: "HubSpot", category: "crm", blurb: "Sync contacts and deal stages", status: "available", priority: 11, accent: "amber", connectedAt: null, detail: null },
  { id: "razorpay", name: "Razorpay", category: "ecommerce", blurb: "Send payment links mid-call", status: "available", priority: 12, accent: "cyan", connectedAt: null, detail: null },
  { id: "slack", name: "Slack alerts", category: "ops", blurb: "Complaint and SLA alerts in channel", status: "available", priority: 13, accent: "coral", connectedAt: null, detail: null },
  { id: "mcp", name: "MCP server", category: "developer", blurb: "Run campaigns from Claude or ChatGPT", status: "available", priority: 14, accent: "violet", connectedAt: null, detail: null },
  { id: "salesforce", name: "Salesforce", category: "crm", blurb: "Enterprise CRM sync", status: "coming_soon", priority: 15, accent: "amber", connectedAt: null, detail: null },
  { id: "freshdesk", name: "Freshdesk", category: "ops", blurb: "Raise tickets from grievance calls", status: "coming_soon", priority: 16, accent: "coral", connectedAt: null, detail: null },
];

/* ── Analytics ──────────────────────────────────────────────────────────── */

const outcomes = ["resolved", "escalated", "no_answer", "dropped", "voicemail"] as const;
const flags = [null, "Tone", "Slow resolve", "Missed disclosure", "Interrupted caller"];

export const callRecords: CallRecord[] = Array.from({ length: 24 }, (_, i) => {
  const agent = agents[Math.floor(rand() * agents.length)];
  const score = Math.round(58 + rand() * 42);
  const flag = score > 85 ? null : flags[1 + Math.floor(rand() * (flags.length - 1))];
  const durationSec = Math.round(45 + rand() * 260);
  return {
    id: `${48213 - i * 3}`,
    phone: ["+919876542214", "+918765430091", "+919012345527", "+917788112233", "+919445566778"][i % 5],
    agentName: agent.name,
    intent: agent.intent,
    language: agent.languages[0],
    direction: agent.direction === "outbound" ? ("outbound" as const) : ("inbound" as const),
    startedAt: ago(i * 22 * MINUTE),
    durationSec,
    outcome: outcomes[Math.floor(rand() * (score > 80 ? 1 : outcomes.length))],
    sentiment: score > 85 ? ("positive" as const) : score > 70 ? ("neutral" as const) : ("declining" as const),
    qaScore: score,
    qaFlag: flag,
    costInr: Number(((durationSec / 60) * 3.05).toFixed(2)),
  };
});

export const analytics: Analytics = {
  avgHandleSec: 134,
  containmentRate: 0.78,
  escalationRate: 0.22,
  csat: 4.4,
  costPerCallInr: 3.2,
  deltas: {
    avgHandleSec: -0.07,
    containmentRate: 0.04,
    escalationRate: -0.04,
    csat: 0.12,
    costPerCallInr: -0.09,
  },
  csatTrend: Array.from({ length: 30 }, (_, i) => ({
    date: isoDay(29 - i),
    value: Number((3.9 + (i / 29) * 0.6 + (rand() - 0.5) * 0.22).toFixed(2)),
  })),
  costTrend: Array.from({ length: 30 }, (_, i) => ({
    date: isoDay(29 - i),
    ai: Number((2.2 + (rand() - 0.5) * 0.5).toFixed(2)),
    telephony: Number((0.55 + (rand() - 0.5) * 0.12).toFixed(2)),
  })),
  outcomeMix: [
    { outcome: "Resolved by agent", count: 2218 },
    { outcome: "Escalated to human", count: 402 },
    { outcome: "No answer", count: 141 },
    { outcome: "Dropped", count: 58 },
    { outcome: "Voicemail", count: 28 },
  ],
  scoredCalls: callRecords,
};

/* ── Settings ───────────────────────────────────────────────────────────── */

export const usage: Usage = {
  plan: "growth",
  planLabel: "Growth",
  planPriceInr: 24999,
  includedMinutes: 6000,
  usedMinutes: 4120,
  overageRateInr: 5,
  cycleStart: isoDay(19),
  cycleEnd: isoDay(-11),
  aiCostInr: 10300,
  telephonyCostInr: 2060,
  dailyMinutes: Array.from({ length: 20 }, (_, i) => ({
    date: isoDay(19 - i),
    minutes: Math.round(140 + rand() * 160),
  })),
};

export const complianceItems: ComplianceItem[] = [
  { key: "dlt_entity", label: "DLT entity registration", description: "Principal Entity registered on the DLT platform — required before any commercial call.", status: "approved", detail: "Entity ID 11010•••4472 · Vodafone Idea DLT", checkedAt: ago(6 * HOUR), automated: true },
  { key: "dlt_templates", label: "DLT content templates", description: "Every script variant must map to an approved template.", status: "review", detail: "14 approved · 2 pending review", checkedAt: ago(6 * HOUR), automated: true },
  { key: "dnd", label: "National DND scrub", description: "Contact lists are scrubbed against the TRAI DND registry before dialling.", status: "active", detail: "Synced 4h ago · 312 numbers excluded", checkedAt: ago(4 * HOUR), automated: true },
  { key: "quiet_hours", label: "Quiet-hours enforcement", description: "Outbound dialling blocked 9pm–9am, enforced in the dialer, not the UI.", status: "active", detail: "0 violations in 90 days", checkedAt: ago(20 * MINUTE), automated: true },
  { key: "consent", label: "Consent capture on all flows", description: "Recording disclosure and consent captured and stored with every call.", status: "active", detail: "100% of live agents", checkedAt: ago(1 * HOUR), automated: true },
  { key: "gst", label: "GST invoicing", description: "GST-compliant invoices issued for every billing cycle.", status: "active", detail: "GSTIN 27AA•••1Z5", checkedAt: ago(2 * DAY), automated: false },
  { key: "residency", label: "Data residency — India", description: "Call audio, transcripts and customer records stored in Indian regions only.", status: "review", detail: "Recordings in ap-south-1 · backups pending migration", checkedAt: ago(3 * DAY), automated: false },
  { key: "dpdp", label: "DPDP Act readiness", description: "Consent artefacts, erasure requests and breach notification process.", status: "pending", detail: "Policy drafted, erasure API not shipped", checkedAt: ago(5 * DAY), automated: false },
];

export const teamMembers: TeamMember[] = [
  { id: "tm1", name: "Rohan Suresh", email: "rohan@robosapien.in", role: "owner", status: "active", lastActiveAt: ago(2 * MINUTE) },
  { id: "tm2", name: "Ops (shared)", email: "ops@robosapien.in", role: "supervisor", status: "active", lastActiveAt: ago(3 * HOUR) },
  { id: "tm3", name: "Meghna R", email: "meghna@robosapien.in", role: "analyst", status: "invited", lastActiveAt: ago(2 * DAY) },
];

export const apiKeys: ApiKey[] = [
  { id: "ak1", label: "Production server", prefix: "sk_live_9f2a", scopes: ["calls:write", "agents:read", "webhooks:manage"], createdAt: ago(30 * DAY), lastUsedAt: ago(4 * MINUTE) },
  { id: "ak2", label: "Staging", prefix: "sk_test_41cb", scopes: ["calls:write", "agents:read"], createdAt: ago(12 * DAY), lastUsedAt: ago(2 * DAY) },
];

export const notifications: AppNotification[] = [
  { id: "nt1", kind: "complaint", title: "Critical complaint breached SLA", body: "#48150 — damaged product, video proof shared. Overdue by 35 minutes.", at: ago(35 * MINUTE), severity: "critical", read: false, href: "/complaints" },
  { id: "nt2", kind: "complaint", title: "Frustrated caller on a live call", body: "+91 87•• •• 0091 sentiment dropped to 0.18 on Grievance intake.", at: ago(3 * MINUTE), severity: "high", read: false, href: "/live" },
  { id: "nt3", kind: "compliance", title: "2 DLT templates pending review", body: "Diwali sale outreach cannot scale past 1,000 calls/day until approved.", at: ago(6 * HOUR), severity: "medium", read: false, href: "/settings" },
  { id: "nt4", kind: "campaign", title: "Delivery failure follow-up paused", body: "Connect rate fell below the 35% floor you set.", at: ago(9 * HOUR), severity: "medium", read: true, href: "/campaigns" },
  { id: "nt5", kind: "billing", title: "69% of plan minutes used", body: "4,120 of 6,000 minutes, 11 days left in the cycle.", at: ago(1 * DAY), severity: "low", read: true, href: "/settings" },
  { id: "nt6", kind: "system", title: "Overflow trunk degraded", body: "Vobiz Delhi ASR at 44%, latency 118ms. Traffic rerouted to Plivo Mumbai.", at: ago(2 * HOUR), severity: "high", read: true, href: "/numbers" },
];

/* ── Departments & action queue ─────────────────────────────────────────── */

export const departments: Department[] = [
  { id: "dept_support", slug: "support", name: "Customer Support", openActions: 3 },
  { id: "dept_logistics", slug: "logistics", name: "Logistics & Delivery", openActions: 2 },
  { id: "dept_technical", slug: "technical", name: "Technical / Maintenance", openActions: 1 },
  { id: "dept_cleaning", slug: "cleaning", name: "Cleaning & Housekeeping", openActions: 1 },
  { id: "dept_payments", slug: "payments", name: "Payments & Billing", openActions: 2 },
  { id: "dept_security", slug: "security", name: "Security & Safety", openActions: 0 },
];

export const actionQueue: ActionItem[] = [
  { id: "act1", department: "Customer Support", departmentId: "dept_support", callId: "48213", complaintRef: "#48213", title: "Wrong item delivered, refund requested", detail: "Complaint #48213 · Priya Menon · +919876542214", severity: "high", status: "open", createdAt: ago(22 * MINUTE), dueAt: ahead(3.6 * HOUR) },
  { id: "act2", department: "Logistics & Delivery", departmentId: "dept_logistics", callId: "48209", complaintRef: "#48209", title: "Late delivery, third occurrence", detail: "Complaint #48209 · Arjun Patel · +918765430091", severity: "medium", status: "open", createdAt: ago(1.4 * HOUR), dueAt: ahead(6.6 * HOUR) },
  { id: "act3", department: "Cleaning & Housekeeping", departmentId: "dept_cleaning", callId: null, complaintRef: "#48214", title: "Washroom near platform 2 reported unclean", detail: "Caller reported overflowing bins and wet floor near the paid washroom, platform 2 side.", severity: "medium", status: "open", createdAt: ago(48 * MINUTE), dueAt: ahead(5 * HOUR) },
  { id: "act4", department: "Technical / Maintenance", departmentId: "dept_technical", callId: null, complaintRef: "#48215", title: "Escalator down at Gate C", detail: "Second report today. Caller is a senior citizen; escalator stopped mid-run.", severity: "high", status: "in_progress", createdAt: ago(2.1 * HOUR), dueAt: ahead(1.5 * HOUR) },
  { id: "act5", department: "Payments & Billing", departmentId: "dept_payments", callId: "48141", complaintRef: "#48141", title: "Charged twice for one order", detail: "Complaint #48141 · Rahul Nair · +918899001122", severity: "high", status: "in_progress", createdAt: ago(1.6 * DAY), dueAt: ahead(4 * HOUR) },
  { id: "act6", department: "Payments & Billing", departmentId: "dept_payments", callId: "48122", complaintRef: "#48122", title: "Refund processed and confirmed", detail: "Complaint #48122 · Neha Sharma · +919012345527", severity: "medium", status: "done", createdAt: ago(3 * DAY), dueAt: ago(2.6 * DAY) },
];

/* ── Invoices ───────────────────────────────────────────────────────────── */

export const invoices: Invoice[] = [
  { id: "inv_demo_prev", cycleStart: ago(50 * DAY), cycleEnd: ago(20 * DAY), plan: "growth", planFeeInr: 24999, overageMinutes: 0, overageInr: 0, totalInr: 24999, status: "paid", paidAt: ago(18 * DAY) },
  { id: "inv_demo_prev2", cycleStart: ago(80 * DAY), cycleEnd: ago(50 * DAY), plan: "growth", planFeeInr: 24999, overageMinutes: 340, overageInr: 1700, totalInr: 26699, status: "paid", paidAt: ago(47 * DAY) },
];

/* ── Session user ───────────────────────────────────────────────────────── */

export const me: SessionUser = {
  id: "usr_demo",
  orgId: "org_demo",
  name: "Demo Owner",
  email: "demo@swara.in",
  role: "owner",
  departmentId: null,
  departmentName: null,
};
