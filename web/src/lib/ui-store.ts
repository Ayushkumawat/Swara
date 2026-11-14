"use client";

import { create } from "zustand";
import type { AgentPlan } from "@/lib/api/schemas";

export type SwaraContext = { agentId?: string; agentName?: string; page?: string };

type UiState = {
  paletteOpen: boolean;
  /** The one Swara surface: setup, building agents, and editing them. */
  swaraOpen: boolean;
  /** Prefills Swara's input, so a screen can hand her context ("make the
   *  complaints agent slower") instead of opening blank. Consumed once. */
  swaraSeed: string;
  /** Which agent / screen the owner is on, so "this agent" resolves. */
  swaraContext: SwaraContext;
  /** The large "Build with Swara" popup: brief → her questions → the plan. */
  buildOpen: boolean;
  /** Prefills the popup's brief. */
  buildBrief: string;
  /** A plan Swara already proposed in chat; the popup opens on its review. */
  buildPlan: AgentPlan | null;
  /** Set when Swara creates agents from another screen; /agents selects it
   *  on arrival and clears it. */
  pendingAgentSelect: string | null;
  notificationsOpen: boolean;
  mobileNavOpen: boolean;
  setPalette: (v: boolean) => void;
  openSwara: (seed?: string, context?: SwaraContext) => void;
  setSwara: (v: boolean) => void;
  openBuild: (start?: { brief?: string; plan?: AgentPlan }) => void;
  closeBuild: () => void;
  setSwaraContext: (context: SwaraContext) => void;
  consumeSwaraSeed: () => string;
  setPendingAgentSelect: (id: string | null) => void;
  setNotifications: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
};

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  swaraOpen: false,
  swaraSeed: "",
  swaraContext: {},
  buildOpen: false,
  buildBrief: "",
  buildPlan: null,
  pendingAgentSelect: null,
  notificationsOpen: false,
  mobileNavOpen: false,
  setPalette: (v) => set({ paletteOpen: v }),
  openSwara: (seed = "", context) =>
    set((s) => ({ swaraOpen: true, swaraSeed: seed, swaraContext: context ?? s.swaraContext })),
  setSwara: (v) => set({ swaraOpen: v }),
  openBuild: (start) => set({ buildOpen: true, buildBrief: start?.brief ?? "", buildPlan: start?.plan ?? null }),
  closeBuild: () => set({ buildOpen: false }),
  setSwaraContext: (context) => set({ swaraContext: context }),
  consumeSwaraSeed: () => {
    const seed = get().swaraSeed;
    if (seed) set({ swaraSeed: "" });
    return seed;
  },
  setPendingAgentSelect: (id) => set({ pendingAgentSelect: id }),
  setNotifications: (v) => set({ notificationsOpen: v }),
  setMobileNav: (v) => set({ mobileNavOpen: v }),
}));
