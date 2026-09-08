"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue } from "motion/react";
import {
  ArrowRightLeft,
  CalendarCheck,
  Database,
  Flag,
  GitBranch,
  MessageSquare,
  PhoneIncoming,
  Split,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import type { FlowEdge, FlowNode, FlowNodeKind } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * Node-graph canvas.
 *
 * Positions live on the node rows and are the only source of truth for both
 * the cards and the wires. Framer's drag transform is visual-only during a
 * drag; on drop we write the new x/y and zero the transform so a reload
 * and a live drag never disagree.
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
  selectedEdgeId,
  linkingFrom,
  onSelect,
  onSelectEdge,
  onMove,
  onDelete,
  onDeleteEdge,
  onConnect,
  onLinkStart,
  onLinkCancel,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedId?: string | null;
  selectedEdgeId?: string | null;
  linkingFrom?: string | null;
  onSelect?: (id: string | null) => void;
  onSelectEdge?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onDelete?: (id: string) => void;
  onDeleteEdge?: (id: string) => void;
  onConnect?: (from: string, to: string) => void;
  onLinkStart?: (from: string) => void;
  onLinkCancel?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [dragDelta, setDragDelta] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const seen = useRef(new Set<string>());

  const measure = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) return;
    setHeights((h) => (h[id] === el.offsetHeight ? h : { ...h, [id]: el.offsetHeight }));
  }, []);

  const basePos = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    },
    [nodes],
  );

  const posOf = (id: string) => {
    const base = basePos(id);
    if (dragDelta?.id === id) return { x: base.x + dragDelta.dx, y: base.y + dragDelta.dy };
    return base;
  };
  const hOf = (id: string) => heights[id] ?? 62;

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") onLinkCancel?.();
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selectedEdgeId) {
        e.preventDefault();
        onDeleteEdge?.(selectedEdgeId);
      } else if (selectedId) {
        const node = nodes.find((n) => n.id === selectedId);
        if (node && node.kind !== "start") {
          e.preventDefault();
          onDelete?.(selectedId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedEdgeId, nodes, onDelete, onDeleteEdge, onLinkCancel]);

  const linkFromPos = linkingFrom ? posOf(linkingFrom) : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-auto rounded-[22px] border border-hairline bg-white/[0.02] p-6"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
      onMouseMove={(e) => {
        if (!linkingFrom || !containerRef.current) return;
        const wrap = containerRef.current.firstElementChild as HTMLElement | null;
        const rect = (wrap ?? containerRef.current).getBoundingClientRect();
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onClick={() => {
        onSelect?.(null);
        onSelectEdge?.(null);
      }}
    >
      <div className="relative" style={{ minWidth: extent.w + 40, minHeight: extent.h + 40 }}>
        <svg className="absolute inset-0 size-full overflow-visible">
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
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
            const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
            const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
            const selected = selectedEdgeId === e.id;

            return (
              <g key={e.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  className="cursor-pointer"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectEdge?.(e.id);
                    onSelect?.(null);
                  }}
                />
                <motion.path
                  d={d}
                  fill="none"
                  stroke={selected ? "rgba(63,224,197,0.95)" : EDGE_STROKE[e.tone]}
                  strokeWidth={selected ? 2.4 : 1.6}
                  markerEnd="url(#flow-arrow)"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.7, delay: 0.15 + i * 0.09, ease: [0.22, 1, 0.36, 1] }}
                  className="pointer-events-none"
                />
                <motion.circle
                  r="2.4"
                  fill={(selected ? "rgba(63,224,197,0.9)" : EDGE_STROKE[e.tone]).replace(/0\.\d+\)/, "0.9)")}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.5, times: [0, 0.1, 0.9, 1] }}
                  className="pointer-events-none"
                >
                  <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${i * 0.5}s`} path={d} />
                </motion.circle>
                {e.label ? (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 8}
                    textAnchor="middle"
                    className="pointer-events-none fill-t3 font-[family-name:var(--font-mono)]"
                    style={{ fontSize: 9.5 }}
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {linkFromPos && cursor ? (
            <path
              d={`M${linkFromPos.x + NODE_W},${linkFromPos.y + hOf(linkingFrom!) / 2} C${linkFromPos.x + NODE_W + 60},${linkFromPos.y + hOf(linkingFrom!) / 2} ${cursor.x - 60},${cursor.y} ${cursor.x},${cursor.y}`}
              fill="none"
              stroke="rgba(63,224,197,0.55)"
              strokeWidth="1.6"
              strokeDasharray="5 4"
              className="pointer-events-none"
            />
          ) : null}
        </svg>

        {nodes.map((n, i) => {
          const first = !seen.current.has(n.id);
          if (first) seen.current.add(n.id);
          return (
            <FlowNodeCard
              key={n.id}
              node={n}
              index={i}
              animateIn={first}
              selected={selectedId === n.id}
              linking={linkingFrom === n.id}
              linkTarget={Boolean(linkingFrom && linkingFrom !== n.id)}
              onMeasure={measure}
              onSelect={() => {
                if (linkingFrom && linkingFrom !== n.id) {
                  onConnect?.(linkingFrom, n.id);
                  return;
                }
                onSelect?.(n.id);
                onSelectEdge?.(null);
              }}
              onMove={onMove}
              onDragPreview={(dx, dy) => setDragDelta({ id: n.id, dx, dy })}
              onDragClear={() => setDragDelta(null)}
              onDelete={() => onDelete?.(n.id)}
              onPortOut={() => onLinkStart?.(n.id)}
            />
          );
        })}
      </div>

      {selectedEdgeId ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteEdge?.(selectedEdgeId);
          }}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-coral/30 bg-coral/[0.12] px-3 py-1.5 text-[11px] text-coral"
        >
          <Trash2 className="size-3" />
          Remove wire
        </button>
      ) : null}
    </div>
  );
}

function FlowNodeCard({
  node,
  index,
  animateIn,
  selected,
  linking,
  linkTarget,
  onMeasure,
  onSelect,
  onMove,
  onDragPreview,
  onDragClear,
  onDelete,
  onPortOut,
}: {
  node: FlowNode;
  index: number;
  animateIn: boolean;
  selected: boolean;
  linking: boolean;
  linkTarget: boolean;
  onMeasure: (id: string, el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onMove?: (id: string, x: number, y: number) => void;
  onDragPreview: (dx: number, dy: number) => void;
  onDragClear: () => void;
  onDelete: () => void;
  onPortOut: () => void;
}) {
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const canDelete = node.kind !== "start";
  const canLeave = node.kind !== "end";

  return (
    <motion.div
      ref={(el) => onMeasure(node.id, el)}
      drag
      dragMomentum={false}
      dragElastic={0}
      onPointerDown={(e) => e.stopPropagation()}
      onDrag={(_, info) => onDragPreview(info.offset.x, info.offset.y)}
      onDragEnd={(_, info) => {
        const nx = Math.max(0, node.x + info.offset.x);
        const ny = Math.max(0, node.y + info.offset.y);
        x.set(0);
        y.set(0);
        onDragClear();
        onMove?.(node.id, nx, ny);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      initial={animateIn ? { opacity: 0, scale: 0.92 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: animateIn ? index * 0.07 : 0, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      whileDrag={{ scale: 1.03, zIndex: 30 }}
      className={cn(
        "glass-strong absolute cursor-grab rounded-[14px] p-3 active:cursor-grabbing",
        selected && "ring-1 ring-cyan/60",
        linking && "ring-1 ring-cyan/80",
        linkTarget && "ring-1 ring-violet/50",
        node.kind === "escalate" && "border-coral/30 bg-coral/[0.1]",
      )}
      style={{ left: node.x, top: node.y, width: NODE_W, x, y }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className={cn("size-3", TONE_CLASS[meta.tone])} strokeWidth={2} />
        <span className="text-[9.5px] uppercase tracking-[0.06em] text-t3">{meta.label}</span>
        {canDelete && selected ? (
          <button
            type="button"
            aria-label="Remove node"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="ml-auto rounded-md p-0.5 text-t3 transition-colors hover:bg-coral/[0.15] hover:text-coral"
          >
            <X className="size-3" />
          </button>
        ) : (
          <span className="ml-auto" />
        )}
      </div>
      <div className="text-[12.5px] font-medium leading-snug text-t1">{node.title}</div>
      {node.detail ? (
        <div className="mt-1 text-[10.5px] leading-snug text-t3">{node.detail}</div>
      ) : null}

      {node.kind !== "start" ? (
        <button
          type="button"
          aria-label="Incoming port"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="absolute left-[-7px] top-1/2 size-3.5 -translate-y-1/2 rounded-full border border-cyan/50 bg-void"
        />
      ) : null}
      {canLeave ? (
        <button
          type="button"
          aria-label="Connect from this node"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onPortOut();
          }}
          className={cn(
            "absolute right-[-7px] top-1/2 size-3.5 -translate-y-1/2 rounded-full border bg-void",
            linking ? "border-cyan bg-cyan" : "border-violet/50 hover:bg-violet",
          )}
        />
      ) : null}
    </motion.div>
  );
}
