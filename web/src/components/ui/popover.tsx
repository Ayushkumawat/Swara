"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";

/**
 * A floating panel anchored under a trigger, rendered into `document.body`.
 *
 * Portalled on purpose: the top bar has its own `backdrop-filter`, and a
 * child with `backdrop-filter` inside such an ancestor only blurs what the
 * ancestor painted — which is why the old notification pane looked like a
 * transparent box. Out here it blurs the page, and `.glass-popover` gives it
 * a real surface either way.
 */
export function AnchoredPopover({
  open,
  onClose,
  anchorRef,
  align = "end",
  width = 360,
  offset = 8,
  className,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  width?: number;
  offset?: number;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  const mounted = useMounted();
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 16);
      const left = align === "end" ? Math.max(8, r.right - w) : Math.min(r.left, window.innerWidth - w - 8);
      setPos({ top: r.bottom + offset, left, width: w });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, align, width, offset]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && pos ? (
        <>
          <div className="fixed inset-0 z-[150]" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.985 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, transformOrigin: align === "end" ? "top right" : "top left" }}
            className={cn("glass-popover z-[151] overflow-hidden rounded-[18px]", className)}
          >
            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
