"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRightLeft,
  CalendarCheck,
  Database,
  Flag,
  GitBranch,
  MessageSquare,
  PhoneIncoming,
  PhoneOff,
  Split,
  Trash2,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import type { FlowEdge, FlowNode, FlowNodeKind } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

/**
 * Node-graph canvas.
 *
 * Positions are plain `left/top` driven by pointer events — no transform
 * layer — so a wire computed from a node's coordinates is always drawn where
 * the node is, mid-drag included. (The earlier version let the drag library
 * apply a transform while the wires read the persisted coordinates; the two
 * disagreed for a frame on every drop, which is the "lines disconnect" bug.)
 *
 * Interactions: drag a node to move it; drag from the right-hand port onto
 * another node to connect; click a wire to select it; Delete/Backspace removes
 * the selection; double-click a wire to relabel it. Every change is lifted to
 * the parent, which owns persistence.
 */

export const NODE_W = 186;

export const KIND_META: Record<
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
  escalate: { label: "Transfer", icon: ArrowRightLeft, tone: "coral" },
  handoff: { label: "Hand off", icon: ArrowRightLeft, tone: "violet" },
  end: { label: "End call", icon: PhoneOff, tone: "grey" },
};

const TONE_CLASS = {
  violet: "text-violet",
  cyan: "text-cyan",
  amber: "text-amber",
  coral: "text-coral",
  grey: "text-t2",
} as const;

const EDGE_STROKE = {
  default: "rgba(124,108,246,0.5)",
  success: "rgba(63,224,197,0.55)",
  danger: "rgba(255,107,107,0.5)",
} as const;

type Pt = { x: number; y: number };

export type FlowSelection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

export function FlowCanvas({
  nodes,
  edges,
  selection,
  onSelect,
  onMove,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onRelabelEdge,
  issues = {},
  busy = false,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selection: FlowSelection;
  onSelect: (sel: FlowSelection) => void;
  onMove: (id: string, x: number, y: number, done: boolean) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onRelabelEdge?: (id: string, label: string) => void;
  /** nodeId → issue text, rendered as a badge. */
  issues?: Record<string, { level: "error" | "warn"; message: string }>;
  /** Dims the canvas while the graph is loading or being generated. */
  busy?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});

  // Wires anchor to the vertical centre of each node, so they need measured
  // heights rather than an assumed constant.
  const measure = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) return;
    setHeights((h) => (h[id] === el.offsetHeight ? h : { ...h, [id]: el.offsetHeight }));
  }, []);

  // Live positions during a drag, overlaying the persisted ones. Cleared the
  // moment the parent's `nodes` prop reflects the drop.
  const [live, setLive] = useState<Record<string, Pt>>({});
  const [nodesSeen, setNodesSeen] = useState(nodes);
  if (nodesSeen !== nodes) {
    setNodesSeen(nodes);
    setLive({});
  }

  const posOf = useCallback(
    (id: string): Pt => {
      const l = live[id];
      if (l) return l;
      const n = nodes.find((x) => x.id === id);
      return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    },
    [live, nodes],
  );
  const hOf = (id: string) => heights[id] ?? 62;

  // A wire being dragged out of a port, before it lands.
  const [pending, setPending] = useState<{ from: string; to: Pt } | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const canvasPoint = (e: { clientX: number; clientY: number }): Pt => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft - 24, y: e.clientY - r.top + el.scrollTop - 24 };
  };

  // Node drag: pointer capture on the card. The card's left/top follow the
  // pointer directly, and the wires read the same numbers.
  const dragRef = useRef<{ id: string; start: Pt; origin: Pt; moved: boolean } | null>(null);

  const onNodePointerDown = (n: FlowNode) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-port]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: n.id, start: { x: e.clientX, y: e.clientY }, origin: posOf(n.id), moved: false };
  };
  const onNodePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const next = { x: Math.max(0, d.origin.x + dx), y: Math.max(0, d.origin.y + dy) };
    setLive((prev) => ({ ...prev, [d.id]: next }));
    onMove(d.id, next.x, next.y, false);
  };
  const onNodePointerUp = (n: FlowNode) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      const p = live[d.id] ?? posOf(d.id);
      onMove(d.id, p.x, p.y, true);
    } else {
      onSelect({ kind: "node", id: n.id });
    }
  };

  // Port drag: starts a pending wire; drop on any node connects.
  const onPortPointerDown = (from: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setPending({ from, to: canvasPoint(e) });
    const move = (ev: PointerEvent) => setPending((p) => (p ? { ...p, to: canvasPoint(ev) } : p));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node]");
      const to = target?.dataset.node;
      setPending(null);
      setHoverNode(null);
      if (to && to !== from) onConnect(from, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Keyboard delete for whatever is selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selection) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selection.kind === "node") onDeleteNode(selection.id);
        else onDeleteEdge(selection.id);
      }
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, onDeleteNode, onDeleteEdge, onSelect]);

  // Absolutely-positioned nodes contribute nothing to layout, so the canvas
  // has to be sized from the graph or the lowest node gets clipped.
  const extent = useMemo(
    () =>
      nodes.reduce(
        (acc, n) => {
          const p = posOf(n.id);
          return { w: Math.max(acc.w, p.x + NODE_W), h: Math.max(acc.h, p.y + hOf(n.id)) };
        },
        { w: 760, h: 380 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, live, heights],
  );

  const wire = (a: Pt, ha: number, b: Pt, hb: number) => {
    const x1 = a.x + NODE_W;
    const y1 = a.y + ha / 2;
    const x2 = b.x;
    const y2 = b.y + hb / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvas) onSelect(null);
      }}
      className={cn(
        "relative w-full overflow-auto rounded-[22px] border border-hairline bg-white/[0.02] p-6 transition-opacity",
        busy && "pointer-events-none opacity-60",
      )}
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div data-canvas className="relative" style={{ minWidth: extent.w + 40, minHeight: extent.h + 40 }}>
        <svg className="absolute inset-0 size-full overflow-visible" style={{ pointerEvents: "none" }}>
          <defs>
            <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(255,255,255,0.32)" />
            </marker>
            <marker id="flow-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="rgba(63,224,197,0.9)" />
            </marker>
          </defs>

          {edges.map((e, i) => {
            const a = posOf(e.from);
            const b = posOf(e.to);
            const { d, mx, my } = wire(a, hOf(e.from), b, hOf(e.to));
            const selected = selection?.kind === "edge" && selection.id === e.id;
            return (
              <g key={e.id}>
                {/* Fat invisible hit area so a 1.6px wire is clickable. */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    onSelect({ kind: "edge", id: e.id });
                  }}
                  onDoubleClick={() => {
                    const label = window.prompt("Label for this branch (what makes the call take it?)", e.label ?? "");
                    if (label !== null) onRelabelEdge?.(e.id, label.trim());
                  }}
                />
                <motion.path
                  d={d}
                  fill="none"
                  stroke={selected ? "rgba(63,224,197,0.95)" : EDGE_STROKE[e.tone]}
                  strokeWidth={selected ? 2.2 : 1.6}
                  markerEnd={selected ? "url(#flow-arrow-hot)" : "url(#flow-arrow)"}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.5, delay: Math.min(0.6, i * 0.05), ease: [0.22, 1, 0.36, 1] }}
                />
                {/* A pulse travelling the wire makes the graph read as a path
                    audio actually flows down, not a static diagram. */}
                {!live[e.from] && !live[e.to] ? (
                  <circle r="2.4" fill={EDGE_STROKE[e.tone].replace(/0\.\d+\)/, "0.9)")}>
                    <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${i * 0.4}s`} path={d} />
                  </circle>
                ) : null}
                {e.label ? (
                  <g>
                    <rect
                      x={mx - e.label.length * 3 - 6}
                      y={my - 15}
                      width={e.label.length * 6 + 12}
                      height={16}
                      rx={8}
                      fill="rgba(10,14,26,0.85)"
                      stroke={selected ? "rgba(63,224,197,0.5)" : "rgba(255,255,255,0.1)"}
                    />
                    <text
                      x={mx}
                      y={my - 4}
                      textAnchor="middle"
                      className="fill-t2 font-[family-name:var(--font-mono)]"
                      style={{ fontSize: 9.5 }}
                    >
                      {e.label}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {pending ? (
            <path
              d={wire(posOf(pending.from), hOf(pending.from), { x: pending.to.x, y: pending.to.y - hOf("") / 2 }, hOf("")).d}
              fill="none"
              stroke="rgba(63,224,197,0.8)"
              strokeWidth="1.8"
              strokeDasharray="5 4"
              markerEnd="url(#flow-arrow-hot)"
            />
          ) : null}
        </svg>

        <AnimatePresence initial={false}>
          {nodes.map((n) => {
            const meta = KIND_META[n.kind];
            const Icon = meta.icon;
            const selected = selection?.kind === "node" && selection.id === n.id;
            const p = posOf(n.id);
            const dragging = !!live[n.id];
            const issue = issues[n.id];
            const isTarget = pending && hoverNode === n.id && pending.from !== n.id;

            return (
              <motion.div
                key={n.id}
                data-node={n.id}
                ref={(el) => measure(n.id, el)}
                layout={false}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: dragging ? 1.03 : 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                onPointerDown={onNodePointerDown(n)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp(n)}
                onPointerEnter={() => pending && setHoverNode(n.id)}
                onPointerLeave={() => pending && setHoverNode(null)}
                className={cn(
                  "glass-strong group absolute select-none rounded-[14px] p-3",
                  dragging ? "z-30 cursor-grabbing shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)]" : "cursor-grab",
                  selected && "ring-1 ring-cyan/60",
                  isTarget && "ring-2 ring-cyan",
                  n.kind === "escalate" && "border-coral/30 bg-coral/[0.1]",
                  n.kind === "handoff" && "border-violet/30 bg-violet/[0.1]",
                  n.kind === "end" && "border-white/10 bg-white/[0.03]",
                  issue?.level === "error" && "border-coral/40",
                )}
                style={{ left: p.x, top: p.y, width: NODE_W, touchAction: "none" }}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Icon className={cn("size-3", TONE_CLASS[meta.tone])} strokeWidth={2} />
                  <span className="text-[9.5px] uppercase tracking-[0.06em] text-t3">{meta.label}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {issue ? (
                      <span title={issue.message}>
                        <TriangleAlert className={cn("size-3", issue.level === "error" ? "text-coral" : "text-amber")} />
                      </span>
                    ) : null}
                    {n.kind !== "start" ? (
                      <button
                        type="button"
                        aria-label="Delete node"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNode(n.id);
                        }}
                        className="rounded p-0.5 text-t3 opacity-0 transition-opacity hover:bg-coral/15 hover:text-coral group-hover:opacity-100"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : null}
                  </span>
                </div>
                <div className="text-[12.5px] font-medium leading-snug text-t1">{n.title}</div>
                {n.detail ? <div className="mt-1 text-[10.5px] leading-snug text-t3">{n.detail}</div> : null}

                {/* Output port: drag to connect. End/handoff/transfer have no next. */}
                {n.kind !== "end" && n.kind !== "handoff" && n.kind !== "escalate" ? (
                  <button
                    type="button"
                    data-port
                    aria-label="Drag to connect"
                    title="Drag to another node to connect"
                    onPointerDown={onPortPointerDown(n.id)}
                    className="absolute -right-[7px] top-1/2 size-[14px] -translate-y-1/2 rounded-full border-2 border-void bg-violet opacity-70 transition hover:scale-125 hover:bg-cyan hover:opacity-100"
                    style={{ touchAction: "none" }}
                  />
                ) : null}
                {/* Input port marker. */}
                {n.kind !== "start" ? (
                  <span className="absolute -left-[5px] top-1/2 size-[10px] -translate-y-1/2 rounded-full border-2 border-void bg-white/25" />
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-center text-[12px] text-t3">
            Empty flow. Add a Start from the palette, or let Swara draft one.
          </div>
        ) : null}
      </div>
    </div>
  );
}
