"use client";

import { motion } from "motion/react";

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="font-[family-name:var(--font-display)] text-[23px] font-semibold tracking-tight text-t1">
          {title}
        </h1>
        {sub ? <p className="mt-1 text-[13px] text-t2">{sub}</p> : null}
      </motion.div>
      {actions ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-wrap gap-2.5"
        >
          {actions}
        </motion.div>
      ) : null}
    </div>
  );
}
