import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { playSound } from "@/lib/sound";
import { TokensMentioned } from "./ActionsPanel";
import { useT, type TFn } from "@/i18n";

type Kind = "alert" | "recommendation";
type Status = "pending" | "executed" | "dismissed";

interface TokenRef {
  symbol: string;
  address: string;
  chain?: string;
}

interface HistoryAction {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  source: string;
  executeInstructions: string;
  tokens?: TokenRef[];
  createdAt: string;
  status: Status;
}

function relativeTime(iso: string, t: TFn): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return t("actionsHistory.justNow");
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t("actionsHistory.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("actionsHistory.hoursAgo", { n: hours });
  return t("actionsHistory.daysAgo", { n: Math.floor(hours / 24) });
}

function dayBucket(iso: string, t: TFn): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return t("actionsHistory.today");
  if (sameDay(d, yest)) return t("actionsHistory.yesterday");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

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
  const t = useT();
  const queryClient = useQueryClient();
  const statusLabel: Record<Status, string> = {
    pending: t("actionsHistory.statusPending"),
    executed: t("actionsHistory.statusExecuted"),
    dismissed: t("actionsHistory.statusHidden"),
  };
  const kindLabel: Record<Kind, string> = {
    alert: t("actionsHistory.kindAlert"),
    recommendation: t("actionsHistory.kindRecommendation"),
  };
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
      const k = dayBucket(a.createdAt, t);
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [filtered, t]);

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
              {t("actionsHistory.actionsHistoryTitle")}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
              {t("actionsHistory.subtitle")}
            </p>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {t("actionsHistory.countsSummary", {
              pending: counts.pending,
              executed: counts.executed,
              dismissed: counts.dismissed,
            })}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
          <FilterPills
            label={t("actionsHistory.kindLabel")}
            value={filterKind}
            onChange={(v) => setFilterKind(v as FilterKind)}
            options={[
              { value: "all", label: t("actionsHistory.filterAll") },
              {
                value: "recommendation",
                label: t("actionsHistory.filterRecommendations"),
              },
              { value: "alert", label: t("actionsHistory.filterAlerts") },
            ]}
          />
          <FilterPills
            label={t("actionsHistory.statusLabel")}
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as FilterStatus)}
            options={[
              { value: "all", label: t("actionsHistory.filterAll") },
              { value: "pending", label: t("actionsHistory.filterPending") },
              { value: "executed", label: t("actionsHistory.filterExecuted") },
              { value: "dismissed", label: t("actionsHistory.filterHidden") },
            ]}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {isLoading && (
          <div className="font-mono text-[11px] text-muted-foreground">
            {t("actionsHistory.loading")}
          </div>
        )}
        {!isLoading && actions.length === 0 && (
          <div className="font-mono text-[11px] text-muted-foreground text-center py-12">
            {t("actionsHistory.noHistory")}
          </div>
        )}
        {!isLoading && actions.length > 0 && filtered.length === 0 && (
          <div className="font-mono text-[11px] text-muted-foreground text-center py-12">
            {t("actionsHistory.noMatch")}
          </div>
        )}
        <div className="max-w-3xl mx-auto space-y-6">
          {grouped.map(([day, items]) => (
            <div key={day} className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0 bg-background py-1">
                {dayBucket(items[0].createdAt, t)}
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
                        <span>{kindLabel[a.kind]}</span>
                        <span>·</span>
                        <span className={STATUS_COLOR[a.status]}>
                          {statusLabel[a.status]}
                        </span>
                        <span>·</span>
                        <span title={new Date(a.createdAt).toLocaleString()}>
                          {relativeTime(a.createdAt, t)}
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
                        title={t("actionsHistory.unhideTitle")}
                      >
                        {t("actionsHistory.unhide")}
                      </Button>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-foreground/80 leading-relaxed pl-5 break-words">
                    {a.description}
                  </div>
                  {a.tokens && a.tokens.length > 0 && (
                    <div className="pl-5">
                      <TokensMentioned tokens={a.tokens} />
                    </div>
                  )}
                  {a.executeInstructions && (
                    <div className="ml-5 font-mono text-[10px] text-muted-foreground/80 bg-foreground/5 border border-border/40 rounded px-2 py-1 leading-relaxed break-words">
                      <span className="text-muted-foreground">
                        {t("actionsHistory.execute")}
                      </span>{" "}
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
