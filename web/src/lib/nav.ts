import {
  Activity,
  BarChart3,
  Blocks,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Contact,
  LayoutDashboard,
  Megaphone,
  PhoneCall,
  ShieldAlert,
  Users,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the live badge counts resolved by the sidebar. */
  badge?: "liveCalls" | "openComplaints";
  keywords?: string[];
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * Grouped by workflow stage, not by object type — project.md §3 asks for a
 * command-centre structure, which means the rail should read like the order
 * someone actually works in over a day.
 */
export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard, keywords: ["home", "dashboard", "today"] },
      { href: "/agents", label: "Agents & flows", icon: Users, keywords: ["builder", "prompt", "graph", "knowledge base"] },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, keywords: ["outbound", "dialer", "contacts", "dnd"] },
      { href: "/live", label: "Live calls", icon: Activity, badge: "liveCalls", keywords: ["monitor", "listen", "takeover", "barge"] },
      { href: "/analytics", label: "Analytics", icon: BarChart3, keywords: ["reports", "csat", "qa", "cost per call"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/bookings", label: "Bookings", icon: CalendarDays, keywords: ["calendar", "appointments", "no-show"] },
      { href: "/complaints", label: "Complaints", icon: ShieldAlert, badge: "openComplaints", keywords: ["grievance", "sla", "escalation", "kanban"] },
      { href: "/queue", label: "Action queue", icon: ClipboardCheck, keywords: ["department", "actions", "follow-up", "cleaning", "technical", "routing"] },
      { href: "/customers", label: "Customer 360", icon: Contact, keywords: ["timeline", "omnichannel", "history", "crm"] },
    ],
  },
  {
    label: "Voice & telephony",
    items: [
      { href: "/voice", label: "Voice studio", icon: Waves, keywords: ["clone", "tts", "persona", "a/b test"] },
      { href: "/numbers", label: "Numbers & SIP", icon: PhoneCall, keywords: ["did", "trunk", "140", "160", "stir shaken"] },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/setup", label: "Workspace setup", icon: ClipboardList, keywords: ["playbook", "departments", "transfer", "appointments", "knowledge", "hours"] },
      { href: "/integrations", label: "Integrations", icon: Blocks, keywords: ["shopify", "zoho", "shiprocket", "webhook", "mcp", "api"] },
      { href: "/settings", label: "Settings", icon: Cog, keywords: ["billing", "plan", "compliance", "dlt", "team", "roles", "keys"] },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

export function navLabelFor(pathname: string) {
  const match = ALL_NAV_ITEMS.find((i) => pathname.startsWith(i.href));
  return match?.label ?? "Overview";
}

export function navGroupFor(pathname: string) {
  const group = NAV.find((g) => g.items.some((i) => pathname.startsWith(i.href)));
  return group?.label ?? "Workspace";
}
