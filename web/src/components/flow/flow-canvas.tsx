"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRightLeft,
  CalendarCheck,
  Database,
  Flag,
  GitBranch,
  MessageSquare,
  PhoneIncoming,
  Split,
  UserRoundCheck,
} from "lucide-react";
import type { FlowEdge, FlowNode, FlowNodeKind } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * Node-graph canvas.
 *
 * Nodes are draggable and positions are lifted to the caller, because §4.2
 * makes the graph the underlying data model for every agent — including ones
 * authored in single-prompt mode — so layout has to persist, not be cosmetic.
 */

const NODE_W = 186;

const KIND_META: Record<
  FlowNodeKind,
  { label: string; icon: typeof Flag; tone: "violet" | "cyan" | "amber" | "coral" | "grey" }
> = {
  start: { label: "Start", icon: PhoneIncoming, tone: "cyan" },
  intent: { label: "Intent", icon: GitBranch, tone: "violet" },
  data_pull: { label: "Data pull", icon: Database, tone: "violet" },
  branch: { label: "Branch", icon: Split, tone: "amber" },
  say: { label: "Say", icon: MessageSquare, tone: "grey" },
  collect: { label: "Collect", icon: UserRoundCheck, tone: "cyan" },
  book: { label: "Book", icon: CalendarCheck, tone: "cyan" },
  escalate: { label: "Escalate", icon: ArrowRightLeft, tone: "coral" },
  end: { label: "End", icon: Flag, tone: "grey" },
};

const TONE_CLASS = {
  violet: "text-violet",
  cyan: "text-cyan",
  amber: "text-amber",
  coral: "text-coral",
  grey: "text-t2",
} as const;

const EDGE_STROKE = {
  default: "rgba(124,108,246,0.45)",
  success: "rgba(63,224,197,0.5)",
  danger: "rgba(255,107,107,0.45)",
} as const;

export function FlowCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  onMove,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});

  // Wires anchor to the vertical centre of each node, so they need measured
  // heights rather than an assumed constant.
  const measure = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) return;
    setHeights((h) => (h[id] === el.offsetHeight ? h : { ...h, [id]: el.offsetHeight }));
  }, []);

  // Drag offsets overlay the persisted node coordinates rather than replacing
  // them, so switching agents resets the canvas instead of stranding one
  // agent's layout on another's graph.
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({});
  const [nodesSeen, setNodesSeen] = useState(nodes);
  if (nodesSeen !== nodes) {
    setNodesSeen(nodes);
    setDragged({});
  }

  const basePos = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    },
    [nodes],
  );

  const posOf = (id: string) => dragged[id] ?? basePos(id);
  const hOf = (id: string) => heights[id] ?? 62;

  // Absolutely-positioned nodes contribute nothing to layout, so the canvas
  // has to be sized from the graph or the lowest node gets clipped.
  const extent = nodes.reduce(
    (acc, n) => {
      const p = posOf(n.id);
      return {
        w: Math.max(acc.w, p.x + NODE_W),
        h: Math.max(acc.h, p.y + hOf(n.id)),
      };
    },
    { w: 760, h: 380 },
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-auto rounded-[22px] border border-hairline bg-white/[0.02] p-6"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div
        className="relative"
        style={{ minWidth: extent.w + 40, minHeight: extent.h + 40 }}
      >
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.32)" />
            </marker>
          </defs>

          {edges.map((e, i) => {
            const a = posOf(e.from);
            const b = posOf(e.to);
            const x1 = a.x + NODE_W;
            const y1 = a.y + hOf(e.from) / 2;
            const x2 = b.x;
            const y2 = b.y + hOf(e.to) / 2;
            const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
            const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;

            return (
              <g key={e.id}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={EDGE_STROKE[e.tone]}
                  strokeWidth="1.6"
                  markerEnd="url(#flow-arrow)"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.7, delay: 0.15 + i * 0.09, ease: [0.22, 1, 0.36, 1] }}
                />
                {/* A pulse travelling the wire makes the graph read as a path
                    audio actually flows down, not a static diagram. */}
                <motion.circle
                  r="2.4"
                  fill={EDGE_STROKE[e.tone].replace(/0\.\d+\)/, "0.9)")}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.5, times: [0, 0.1, 0.9, 1] }}
                  style={{ offsetPath: `path("${d}")` } as React.CSSProperties}
                >
                  <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${i * 0.5}s`} path={d} />
                </motion.circle>
                {e.label ? (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                    className="fill-t3 font-[family-name:var(--font-mono)]"
                    style={{ fontSize: 9.5 }}
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {nodes.map((n, i) => {
          const meta = KIND_META[n.kind];
          const Icon = meta.icon;
          const selected = selectedId === n.id;
          const p = posOf(n.id);

          return (
            <motion.div
              key={n.id}
              ref={(el) => measure(n.id, el)}
              drag
              dragMomentum={false}
              dragElastic={0}
              onDrag={(_, info) => {
                setDragged((prev) => ({
                  ...prev,
                  [n.id]: { x: n.x + info.offset.x, y: n.y + info.offset.y },
                }));
              }}
              onDragEnd={(_, info) => onMove?.(n.id, n.x + info.offset.x, n.y + info.offset.y)}
              onClick={() => onSelect?.(n.id)}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -2 }}
              whileDrag={{ scale: 1.03, zIndex: 30 }}
              className={cn(
                "glass-strong absolute cursor-grab rounded-[14px] p-3 active:cursor-grabbing",
                selected && "ring-1 ring-cyan/60",
                n.kind === "escalate" && "border-coral/30 bg-coral/[0.1]",
              )}
              style={{ left: p.x, top: p.y, width: NODE_W }}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <Icon className={cn("size-3", TONE_CLASS[meta.tone])} strokeWidth={2} />
                <span className="text-[9.5px] uppercase tracking-[0.06em] text-t3">
                  {meta.label}
                </span>
              </div>
              <div className="text-[12.5px] font-medium leading-snug text-t1">{n.title}</div>
              {n.detail ? (
                <div className="mt-1 text-[10.5px] leading-snug text-t3">{n.detail}</div>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
