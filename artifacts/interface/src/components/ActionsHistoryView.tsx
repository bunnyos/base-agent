import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { playSound } from "@/lib/sound";

type Kind = "alert" | "recommendation";
type Status = "pending" | "executed" | "dismissed";

interface HistoryAction {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  source: string;
  executeInstructions: string;
  createdAt: string;
  status: Status;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "today";
  if (sameDay(d, yest)) return "yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const STATUS_LABEL: Record<Status, string> = {
  pending: "pending",
  executed: "executed",
  dismissed: "hidden",
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "text-yellow",
  executed: "text-green",
  dismissed: "text-muted-foreground/60",
};

const KIND_COLOR: Record<Kind, string> = {
  alert: "text-yellow",
  recommendation: "text-green",
};

type FilterKind = "all" | Kind;
type FilterStatus = "all" | Status;

export function ActionsHistoryView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/actions/history"],
    queryFn: async (): Promise<{ actions: HistoryAction[] }> => {
      const r = await fetch("/api/actions/history");
      if (!r.ok) return { actions: [] };
      return (await r.json()) as { actions: HistoryAction[] };
    },
    refetchInterval: 30_000,
  });

  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  const actions = data?.actions ?? [];

  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, executed: 0, dismissed: 0 };
    for (const a of actions) c[a.status]++;
    return c;
  }, [actions]);

  const filtered = useMemo(() => {
    return actions
      .filter((a) => filterKind === "all" || a.kind === filterKind)
      .filter((a) => filterStatus === "all" || a.status === filterStatus);
  }, [actions, filterKind, filterStatus]);

  // Group by day bucket, preserving newest-first order from the API.
  const grouped = useMemo(() => {
    const m = new Map<string, HistoryAction[]>();
    for (const a of filtered) {
      const k = dayBucket(a.createdAt);
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [filtered]);

  const unhide = async (id: string) => {
    playSound("click");
    await fetch(`/api/actions/${id}/unhide`, { method: "POST" });
    queryClient.invalidateQueries({ queryKey: ["/api/actions/history"] });
    queryClient.invalidateQueries({ queryKey: ["/api/actions"] });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="px-4 sm:px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <div>
            <h2 className="font-sans text-lg text-foreground">
              actions history
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
              everything your actions have ever posted — pending, executed,
              and hidden — newest first.
            </p>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {counts.pending} pending · {counts.executed} executed ·{" "}
            {counts.dismissed} hidden
          </div>
        </div>
        <div className="mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
          <FilterPills
            label="kind"
            value={filterKind}
            onChange={(v) => setFilterKind(v as FilterKind)}
            options={[
              { value: "all", label: "all" },
              { value: "recommendation", label: "recommendations" },
              { value: "alert", label: "alerts" },
            ]}
          />
          <FilterPills
            label="status"
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as FilterStatus)}
            options={[
              { value: "all", label: "all" },
              { value: "pending", label: "pending" },
              { value: "executed", label: "executed" },
              { value: "dismissed", label: "hidden" },
            ]}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {isLoading && (
          <div className="font-mono text-[11px] text-muted-foreground">
            loading…
          </div>
        )}
        {!isLoading && actions.length === 0 && (
          <div className="font-mono text-[11px] text-muted-foreground text-center py-12">
            no history yet. once your actions start posting, you'll see them
            here.
          </div>
        )}
        {!isLoading && actions.length > 0 && filtered.length === 0 && (
          <div className="font-mono text-[11px] text-muted-foreground text-center py-12">
            nothing matches these filters.
          </div>
        )}
        <div className="max-w-3xl mx-auto space-y-6">
          {grouped.map(([day, items]) => (
            <div key={day} className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0 bg-background py-1">
                {day}
              </div>
              {items.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    "border border-border/60 rounded-md p-3 space-y-1.5",
                    a.status === "dismissed" && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "font-mono text-sm leading-none mt-0.5",
                        KIND_COLOR[a.kind],
                      )}
                    >
                      ●
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-foreground font-medium leading-snug">
                        {a.title}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/80 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{a.kind}</span>
                        <span>·</span>
                        <span className={STATUS_COLOR[a.status]}>
                          {STATUS_LABEL[a.status]}
                        </span>
                        <span>·</span>
                        <span title={new Date(a.createdAt).toLocaleString()}>
                          {relativeTime(a.createdAt)}
                        </span>
                        <span>·</span>
                        <span className="truncate" title={a.source}>
                          {a.source}
                        </span>
                      </div>
                    </div>
                    {a.status === "dismissed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => unhide(a.id)}
                        className="h-6 px-2 font-mono text-[10px] text-muted-foreground"
                        title="restore to the live inbox"
                      >
                        unhide
                      </Button>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-foreground/80 leading-relaxed pl-5">
                    {a.description}
                  </div>
                  {a.executeInstructions && (
                    <div className="ml-5 font-mono text-[10px] text-muted-foreground/80 bg-foreground/5 border border-border/40 rounded px-2 py-1 leading-relaxed">
                      <span className="text-muted-foreground">execute:</span>{" "}
                      <span className="text-foreground/80">
                        {a.executeInstructions}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterPills({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}:
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "font-mono text-[10px] px-2 py-0.5 rounded border transition-colors",
            value === o.value
              ? "bg-foreground/10 border-foreground/30 text-foreground"
              : "bg-transparent border-border/40 text-muted-foreground/70 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
