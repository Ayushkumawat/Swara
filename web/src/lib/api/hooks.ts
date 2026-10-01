"use client";

import { useQuery } from "@tanstack/react-query";
import { endpoints } from "./client";

/** Query keys are flat and stable so the command palette and Swara can
 *  invalidate slices of the cache without knowing who rendered them. */
export const qk = {
  overview: ["overview"] as const,
  agents: ["agents"] as const,
  agentVersions: ["agents", "versions"] as const,
  knowledge: ["agents", "knowledge"] as const,
  liveCalls: ["calls", "live"] as const,
  campaigns: ["campaigns"] as const,
  scrubStatus: ["campaigns", "scrub"] as const,
  bookings: ["bookings"] as const,
  complaints: ["complaints"] as const,
  customers: ["customers"] as const,
  voices: ["voices"] as const,
  scriptTests: ["voices", "tests"] as const,
  numbers: ["numbers"] as const,
  security: ["numbers", "security"] as const,
  trunks: ["numbers", "trunks"] as const,
  integrations: ["integrations"] as const,
  analytics: ["analytics"] as const,
  usage: ["billing", "usage"] as const,
  compliance: ["compliance"] as const,
  team: ["team"] as const,
  apiKeys: ["api-keys"] as const,
  notifications: ["notifications"] as const,
  departments: ["departments"] as const,
  departmentSuggestions: ["departments", "suggestions"] as const,
  actions: ["actions"] as const,
  invoices: ["billing", "invoices"] as const,
  me: ["auth", "me"] as const,
  playbook: ["setup", "playbook"] as const,
  setupStatus: ["setup", "status"] as const,
  transfers: ["setup", "transfers"] as const,
  appointments: ["setup", "appointments"] as const,
  connectors: ["setup", "connectors"] as const,
  templates: ["agents", "templates"] as const,
  campaignContacts: (id: string) => ["campaigns", id, "contacts"] as const,
};

export const useOverview = () =>
  useQuery({ queryKey: qk.overview, queryFn: endpoints.overview });

export const useAgents = () =>
  useQuery({ queryKey: qk.agents, queryFn: endpoints.agents });

export const useAgentVersions = () =>
  useQuery({ queryKey: qk.agentVersions, queryFn: endpoints.agentVersions });

export const useKnowledge = () =>
  useQuery({ queryKey: qk.knowledge, queryFn: endpoints.knowledge });

/** Live calls poll on a short interval. When the real backend lands this
 *  should become a websocket/SSE subscription — see useLiveClock for the
 *  per-second duration ticking, which stays client-side either way. */
export const useLiveCalls = () =>
  useQuery({
    queryKey: qk.liveCalls,
    queryFn: endpoints.liveCalls,
    refetchInterval: 8_000,
    staleTime: 0,
  });

export const useCampaigns = () =>
  useQuery({ queryKey: qk.campaigns, queryFn: endpoints.campaigns });

export const useScrubStatus = () =>
  useQuery({ queryKey: qk.scrubStatus, queryFn: endpoints.scrubStatus });

export const useBookings = () =>
  useQuery({ queryKey: qk.bookings, queryFn: endpoints.bookings });

export const useComplaints = () =>
  useQuery({ queryKey: qk.complaints, queryFn: endpoints.complaints });

export const useCustomers = () =>
  useQuery({ queryKey: qk.customers, queryFn: endpoints.customers });

export const useVoices = () =>
  useQuery({ queryKey: qk.voices, queryFn: endpoints.voices });

export const useScriptTests = () =>
  useQuery({ queryKey: qk.scriptTests, queryFn: endpoints.scriptTests });

export const useNumbers = () =>
  useQuery({ queryKey: qk.numbers, queryFn: endpoints.numbers });

export const useSecuritySettings = () =>
  useQuery({ queryKey: qk.security, queryFn: endpoints.security });

export const useTrunks = () =>
  useQuery({ queryKey: qk.trunks, queryFn: endpoints.trunks });

export const useIntegrations = () =>
  useQuery({ queryKey: qk.integrations, queryFn: endpoints.integrations });

export const useAnalytics = () =>
  useQuery({ queryKey: qk.analytics, queryFn: endpoints.analytics });

export const useUsage = () =>
  useQuery({ queryKey: qk.usage, queryFn: endpoints.usage });

export const useCompliance = () =>
  useQuery({ queryKey: qk.compliance, queryFn: endpoints.compliance });

export const useTeam = () =>
  useQuery({ queryKey: qk.team, queryFn: endpoints.team });

export const useApiKeys = () =>
  useQuery({ queryKey: qk.apiKeys, queryFn: endpoints.apiKeys });

export const useNotifications = () =>
  useQuery({ queryKey: qk.notifications, queryFn: endpoints.notifications });

export const useDepartments = () =>
  useQuery({ queryKey: qk.departments, queryFn: endpoints.departments });

/** Desks the org's use case usually has and it has not added yet. */
export const useDepartmentSuggestions = () =>
  useQuery({ queryKey: qk.departmentSuggestions, queryFn: endpoints.departmentSuggestions });

/** The signed-in user's action queue — department-scoped server-side. Polls
 *  because new actions arrive from live calls ending, not from this user. */
export const useActions = () =>
  useQuery({ queryKey: qk.actions, queryFn: endpoints.actions, refetchInterval: 15_000 });

export const useInvoices = () =>
  useQuery({ queryKey: qk.invoices, queryFn: endpoints.invoices });

export const useMe = () =>
  useQuery({ queryKey: qk.me, queryFn: endpoints.me, staleTime: 5 * 60_000, retry: false });

export const usePlaybook = () =>
  useQuery({ queryKey: qk.playbook, queryFn: endpoints.playbook });

export const useSetupStatus = () =>
  useQuery({ queryKey: qk.setupStatus, queryFn: endpoints.setupStatus });

export const useTransfers = () =>
  useQuery({ queryKey: qk.transfers, queryFn: endpoints.transfers });

export const useAppointmentTypes = () =>
  useQuery({ queryKey: qk.appointments, queryFn: endpoints.appointmentTypes });

export const useConnectors = () =>
  useQuery({ queryKey: qk.connectors, queryFn: endpoints.connectors });

export const useAgentTemplates = () =>
  useQuery({ queryKey: qk.templates, queryFn: endpoints.templates });

export const useCampaignContacts = (id: string | null) =>
  useQuery({
    queryKey: qk.campaignContacts(id ?? ""),
    queryFn: () => endpoints.campaignContacts(id!),
    enabled: Boolean(id),
  });
