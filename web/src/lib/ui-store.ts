"use client";

import { create } from "zustand";

type UiState = {
  paletteOpen: boolean;
  copilotOpen: boolean;
  copilotSeed: string;
  notificationsOpen: boolean;
  mobileNavOpen: boolean;
  setPalette: (v: boolean) => void;
  /** `seed` prefills the copilot input, so a screen can hand it context
   *  ("edit the delivery-reschedule flow") instead of opening it blank. */
  openCopilot: (seed?: string) => void;
  setCopilot: (v: boolean) => void;
  setNotifications: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
};

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  copilotOpen: false,
  copilotSeed: "",
  notificationsOpen: false,
  mobileNavOpen: false,
  setPalette: (v) => set({ paletteOpen: v }),
  openCopilot: (seed = "") => set({ copilotOpen: true, copilotSeed: seed }),
  setCopilot: (v) => set({ copilotOpen: v }),
  setNotifications: (v) => set({ notificationsOpen: v }),
  setMobileNav: (v) => set({ mobileNavOpen: v }),
}));
