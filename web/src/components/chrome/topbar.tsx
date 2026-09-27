"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, Sparkles, X } from "lucide-react";
import { navGroupFor, navLabelFor } from "@/lib/nav";
import { useUi } from "@/lib/ui-store";
import { useLiveCalls, useMe } from "@/lib/api/hooks";
import { initialsOf } from "@/lib/utils";
import { IconButton } from "@/components/ui/button";
import { LiveDot } from "@/components/ui/pill";
import { NotificationCenter } from "./notifications";
import { SidebarContent } from "./sidebar";

export function Topbar() {
  const pathname = usePathname();
  const setPalette = useUi((s) => s.setPalette);
  const openCopilot = useUi((s) => s.openCopilot);
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const setMobileNav = useUi((s) => s.setMobileNav);
  const { data: live } = useLiveCalls();
  const { data: me } = useMe();
  const user = me?.user;
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";

  return (
    <>
      <header className="sticky top-0 z-40 -mx-5 mb-5 flex items-center gap-3 border-b border-hairline bg-void/70 px-5 py-3 backdrop-blur-[24px] md:-mx-7 md:px-7">
        <button
          onClick={() => setMobileNav(true)}
          aria-label="Open navigation"
          className="text-t2 transition-colors hover:text-t1 lg:hidden"
        >
          <Menu className="size-5" />
        </button>

        <div className="hidden truncate text-[13px] text-t3 md:block">
          {navGroupFor(pathname)} / <span className="text-t1">{navLabelFor(pathname)}</span>
        </div>

        {/* Search opens the palette rather than being its own input — one
            search surface, reachable by click or ⌘K. */}
        <button
          onClick={() => setPalette(true)}
          className="glass ml-auto flex items-center gap-2 rounded-full px-[13px] py-[9px] text-[13px] text-t3 transition-colors hover:bg-white/[0.075] hover:text-t2 md:ml-4 md:mr-auto md:w-[300px]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[15px]">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <span className="hidden truncate md:block">Search agents, calls, customers…</span>
          <kbd className="ml-auto hidden rounded border border-hairline px-1.5 py-px font-[family-name:var(--font-mono)] text-[10px] md:block">
            ⌘K
          </kbd>
        </button>

        <div className="flex items-center gap-2.5">
          {live?.length ? (
            <div className="glass hidden items-center gap-2 rounded-full px-3 py-[7px] sm:flex">
              <LiveDot />
              <span className="font-[family-name:var(--font-mono)] text-[11.5px] text-t2">
                {live.length} live
              </span>
            </div>
          ) : null}

          <IconButton title="Flow copilot" onClick={() => openCopilot()}>
            <Sparkles strokeWidth={1.7} />
          </IconButton>

          <div className="relative">
            <NotificationCenter />
          </div>

          <button
            className="flex size-[34px] items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-xs font-semibold text-[#1a0e08]"
            style={{ background: "linear-gradient(135deg, var(--color-amber), var(--color-coral))" }}
            title={user ? `${user.name}${roleLabel ? ` · ${roleLabel}` : ""}` : "Account"}
          >
            {user ? initialsOf(user.name) : "·"}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {mobileNavOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNav(false)}
              className="fixed inset-0 z-[88] bg-void/70 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 36 }}
              className="glass-strong fixed left-0 top-0 z-[89] h-full w-[268px] border-r border-hairline lg:hidden"
            >
              <button
                onClick={() => setMobileNav(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-4 z-10 text-t3 hover:text-t1"
              >
                <X className="size-4" />
              </button>
              <SidebarContent onNavigate={() => setMobileNav(false)} />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
