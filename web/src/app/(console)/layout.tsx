"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AmbientGlows, PageTransition } from "@/components/motion/primitives";
import { Sidebar } from "@/components/chrome/sidebar";
import { Topbar } from "@/components/chrome/topbar";
import { useUi } from "@/lib/ui-store";

/**
 * The palette and copilot are opened by keystroke, not on load, so neither
 * belongs in the first bundle. cmdk and the copilot's message UI arrive only
 * once the user reaches for them.
 */
const CommandPalette = dynamic(
  () => import("@/components/chrome/command-palette").then((m) => m.CommandPalette),
  { ssr: false },
);

const CopilotDrawer = dynamic(
  () => import("@/components/chrome/copilot").then((m) => m.CopilotDrawer),
  { ssr: false },
);

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const setPalette = useUi((s) => s.setPalette);
  const openCopilot = useUi((s) => s.openCopilot);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
      }
      // ⌘J for the copilot — reachable from anywhere, which is the point of
      // treating it as a load-bearing feature rather than a widget.
      if (meta && e.key.toLowerCase() === "j") {
        e.preventDefault();
        openCopilot();
      }
      if (e.key === "Escape") {
        setPalette(false);
        useUi.getState().setCopilot(false);
        useUi.getState().setNotifications(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCopilot, setPalette]);

  return (
    <>
      <AmbientGlows />
      <div className="relative z-10 flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 px-5 pb-16 md:px-7">
          <Topbar />
          <PageTransition routeKey={pathname}>{children}</PageTransition>
        </main>
      </div>
      <CommandPalette />
      <CopilotDrawer />
    </>
  );
}
