"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Centered dialog. Replaces window.prompt/confirm, which cannot be styled,
 * block the event loop, and look like a browser error to anyone not a
 * developer. Escape and backdrop close it; focus goes to the first field.
 */
export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  width = 460,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  sub?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mounted = useMounted();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal
            initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.26, ease: EASE }}
            style={{ width: `min(${width}px, 100%)` }}
            className={cn("glass-strong relative max-h-[90vh] overflow-y-auto rounded-[22px] p-5", className)}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-[family-name:var(--font-display)] text-[16px] font-semibold text-t1">{title}</h2>
                {sub ? <p className="mt-1 text-[12px] leading-snug text-t3">{sub}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 text-t3 transition-colors hover:bg-white/[0.06] hover:text-t1"
              >
                <X className="size-4" />
              </button>
            </div>
            {children}
            {footer ? <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
