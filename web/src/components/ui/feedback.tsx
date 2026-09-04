"use client";

import { cn } from "@/lib/utils";
import { Card } from "./card";
import { Button } from "./button";

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn("skeleton", className)} style={style} />;
}

/** Skeleton shaped like a MetricCard, so the layout does not jump when data
 *  lands. Every loading state in the console is shape-matched, not a spinner. */
export function MetricSkeleton() {
  return (
    <Card className="p-[18px]" interactive={false}>
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="size-[30px] rounded-[9px]" />
        <Skeleton className="h-3 w-9" />
      </div>
      <Skeleton className="h-7 w-24" />
      <Skeleton className="mt-2 h-3 w-32" />
    </Card>
  );
}

export function RowsSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-[10px]" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 140 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2.5" style={{ height }}>
      {[52, 68, 44, 78, 61, 95, 58].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

export function CardSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton className="w-full rounded-[22px]" style={{ height }} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-[14px] bg-white/[0.05] text-t3 [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h4 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-t1">
        {title}
      </h4>
      <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-t2">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6M12 16.5h.01" />
        </svg>
      }
      title="Couldn't load that"
      body={message ?? "The request failed. This is usually transient — try again."}
      action={
        onRetry ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}

/** Renders loading/error/empty/success without each screen re-implementing
 *  the same four branches. */
export function QueryBoundary<T>({
  query,
  skeleton,
  empty,
  children,
}: {
  query: {
    data: T | undefined;
    isPending: boolean;
    isError: boolean;
    error?: unknown;
    refetch?: () => void;
  };
  skeleton: React.ReactNode;
  empty?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError)
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={query.refetch}
      />
    );
  if (!query.data) return <>{empty ?? null}</>;
  if (Array.isArray(query.data) && query.data.length === 0 && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
