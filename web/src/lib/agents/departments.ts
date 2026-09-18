import type { UseCase } from "@/lib/api/schemas";

/**
 * Departments are tenant data, not platform data. Nothing in the product
 * assumes a "support" or "cleaning" desk exists; the only row every org gets
 * is `general`, which is where a complaint lands when nobody else claims it.
 *
 * These lists are *suggestions* shown on the Setup page and applied once,
 * when an owner picks a use case in onboarding and has not yet added a desk
 * of their own. The owner can delete or rename any of them.
 */
export type DepartmentSuggestion = { slug: string; name: string; keywords: string[] };

export const GENERAL_DEPARTMENT: DepartmentSuggestion = {
  slug: "general",
  name: "General",
  keywords: [],
};

export const DEPARTMENTS_BY_USE_CASE: Record<UseCase, DepartmentSuggestion[]> = {
  clinic: [
    { slug: "front-desk", name: "Front desk", keywords: ["appointment", "reschedule", "cancel", "timing", "directions"] },
    { slug: "billing", name: "Billing & insurance", keywords: ["bill", "payment", "insurance", "receipt", "charged"] },
    { slug: "pharmacy", name: "Pharmacy & reports", keywords: ["report", "prescription", "medicine", "lab", "result"] },
    { slug: "doctor-queries", name: "Doctor queries", keywords: ["doctor", "consult", "second opinion", "follow up"] },
  ],
  ecommerce: [
    { slug: "orders", name: "Orders & returns", keywords: ["order", "return", "wrong item", "missing", "damaged", "exchange"] },
    { slug: "logistics", name: "Logistics & delivery", keywords: ["delivery", "courier", "late", "delay", "reschedule", "address", "pickup"] },
    { slug: "payments", name: "Payments & refunds", keywords: ["payment", "refund", "charged", "upi", "cod", "card"] },
    { slug: "product", name: "Product & quality", keywords: ["quality", "defective", "not working", "size", "expired"] },
  ],
  customer_care: [
    { slug: "support", name: "Customer support", keywords: ["complaint", "issue", "problem", "experience", "rude", "behaviour"] },
    { slug: "billing", name: "Billing & accounts", keywords: ["bill", "invoice", "charged", "plan", "payment", "account"] },
    { slug: "technical", name: "Technical support", keywords: ["not working", "error", "app", "login", "fault", "outage"] },
    { slug: "escalations", name: "Escalations", keywords: ["supervisor", "manager", "legal", "consumer court", "escalate"] },
  ],
  sales: [
    { slug: "sales", name: "Sales", keywords: ["price", "plan", "quote", "demo", "buy", "discount"] },
    { slug: "onboarding", name: "Onboarding", keywords: ["setup", "activate", "start", "install", "training"] },
    { slug: "accounts", name: "Accounts & renewals", keywords: ["renew", "invoice", "payment", "contract", "gst"] },
  ],
  civic: [
    { slug: "cleaning", name: "Cleaning & housekeeping", keywords: ["clean", "dirty", "garbage", "toilet", "smell", "hygiene", "washroom"] },
    { slug: "technical", name: "Technical / maintenance", keywords: ["escalator", "lift", "ac", "fault", "broken", "not working", "light"] },
    { slug: "security", name: "Security & safety", keywords: ["harassment", "theft", "unsafe", "cctv", "fight", "emergency", "lost"] },
    { slug: "ticketing", name: "Ticketing & fares", keywords: ["ticket", "fare", "card", "recharge", "balance", "refund", "qr"] },
    { slug: "operations", name: "Operations & timings", keywords: ["timing", "schedule", "delay", "route", "first train", "last train"] },
  ],
  hospitality: [
    { slug: "reservations", name: "Reservations", keywords: ["book", "table", "room", "reservation", "cancel", "reschedule"] },
    { slug: "housekeeping", name: "Housekeeping", keywords: ["clean", "towel", "room service", "dirty", "ac", "not working"] },
    { slug: "billing", name: "Billing", keywords: ["bill", "charged", "payment", "invoice", "refund"] },
    { slug: "events", name: "Events & banquets", keywords: ["event", "party", "banquet", "wedding", "catering"] },
  ],
  education: [
    { slug: "admissions", name: "Admissions", keywords: ["admission", "enrol", "course", "eligibility", "seat", "apply"] },
    { slug: "fees", name: "Fees & accounts", keywords: ["fee", "payment", "instalment", "receipt", "refund", "scholarship"] },
    { slug: "academics", name: "Academics", keywords: ["class", "batch", "schedule", "teacher", "exam", "result"] },
    { slug: "counselling", name: "Counselling", keywords: ["counsel", "guidance", "career", "doubt", "mentor"] },
  ],
  other: [],
};

export function suggestedDepartmentsFor(useCase: string | undefined | null): DepartmentSuggestion[] {
  if (!useCase || !(useCase in DEPARTMENTS_BY_USE_CASE)) return [];
  return DEPARTMENTS_BY_USE_CASE[useCase as UseCase];
}
