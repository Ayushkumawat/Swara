import type { UseCase } from "@/lib/api/schemas";

/**
 * What each kind of business needs configured before its agents can run,
 * and which agents it typically wants. Drives the Setup page's emphasis and
 * the planner's fallback — a clinic is booking-first, customer care is
 * routing-first, sales needs inbound *and* outbound.
 */
export type SetupArea = "playbook" | "departments" | "transfers" | "appointments" | "knowledge" | "orders";

export const USE_CASES: Record<
  UseCase,
  {
    label: string;
    blurb: string;
    /** Areas in priority order; the first two are "must have". */
    focus: SetupArea[];
    agents: string[];
    hint: string;
  }
> = {
  clinic: {
    label: "Clinic / healthcare",
    blurb: "Appointments, reschedules, fees, directions. A receptionist who never double-books.",
    focus: ["appointments", "knowledge", "transfers", "playbook"],
    agents: ["Appointment booking (inbound)", "Appointment reminder (outbound)", "Front door"],
    hint: "Booking-first. Add every consultation type with its duration and hours; add fees and timings to knowledge so the agent quotes them exactly.",
  },
  ecommerce: {
    label: "E-commerce / D2C",
    blurb: "Where is my order, returns, refunds, failed deliveries, COD confirmation.",
    focus: ["orders", "departments", "transfers", "knowledge", "appointments"],
    agents: ["Order status", "Complaints & refunds", "Delivery reschedule (outbound)", "COD reminder (outbound)"],
    hint: "Connect order lookup first — it is the tool most calls use. Return and refund policy belongs in knowledge, not in the agent's head.",
  },
  customer_care: {
    label: "Customer care",
    blurb: "One number in, many teams behind it. Route, log, escalate, never lose a complaint.",
    focus: ["departments", "transfers", "knowledge", "playbook"],
    agents: ["Front door (routes)", "Complaints & refunds", "Billing / account queries", "Technical support"],
    hint: "Routing-first. Teams with routing words decide who owns follow-up; the people you list decide who a call can reach.",
  },
  sales: {
    label: "Sales & lead follow-up",
    blurb: "Answer product questions, qualify, book demos, follow up on enquiries.",
    focus: ["knowledge", "appointments", "transfers", "playbook"],
    agents: ["Sales enquiry (inbound)", "Lead follow-up (outbound)"],
    hint: "Inbound and outbound both. Pricing and plans go in knowledge; a demo or callback slot type lets the agent book a next step instead of promising one.",
  },
  civic: {
    label: "Civic / transport helpline",
    blurb: "Grievances, lost and found, timings, fares. High volume, many languages.",
    focus: ["departments", "knowledge", "transfers", "playbook"],
    agents: ["Grievance intake", "Enquiry (timings, fares)", "Front door"],
    hint: "Teams matter most here — cleaning, security, technical each get their own queue. Fares and timetables go in knowledge.",
  },
  hospitality: {
    label: "Hospitality / restaurant",
    blurb: "Reservations, room enquiries, event bookings, feedback.",
    focus: ["appointments", "knowledge", "transfers", "playbook"],
    agents: ["Reservations", "Enquiry", "Feedback follow-up (outbound)"],
    hint: "Table or room types become appointment types; menus, tariffs and policies go in knowledge.",
  },
  education: {
    label: "Education / coaching",
    blurb: "Admissions enquiries, counselling slots, fee queries, reminders.",
    focus: ["knowledge", "appointments", "transfers", "playbook"],
    agents: ["Admissions enquiry", "Counselling booking", "Fee reminder (outbound)"],
    hint: "Course details and fees in knowledge; counselling slots as appointment types; a counsellor as a person agents can reach.",
  },
  other: {
    label: "Something else",
    blurb: "Tell Swara what you do and she will work out what is needed.",
    focus: ["playbook", "knowledge", "transfers", "departments"],
    agents: ["Reception"],
    hint: "Start with what you do and who a call should reach. Switch on the rest only when the calls show you need it.",
  },
};
