import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/sound";
import { useT, type TFn } from "@/i18n";
import { useTabs } from "./TabsContext";
const ACTIONS_BUILDER_TAB: {
  id: "actions-builder";
  title: string;
  titleKey: string;
  kind: "actions-builder";
  closable: boolean;
} = {
  id: "actions-builder",
  title: "actions builder",
  titleKey: "tabs.actionsBuilder",
  kind: "actions-builder",
  closable: false,
};
const ACTIONS_HISTORY_TAB: {
  id: "actions-history";
  title: string;
  titleKey: string;
  kind: "actions-history";
  closable: boolean;
} = {
  id: "actions-history",
  title: "actions history",
  titleKey: "tabs.actionsHistory",
  kind: "actions-history",
  closable: false,
};
import { Check, Copy, EyeOff, History, Play, Settings2 } from "lucide-react";
import { useState } from "react";

type ActionKind = "alert" | "recommendation";
type Status = "pending" | "executed" | "dismissed";

interface TokenRef {
  symbol: string;
  address: string;
  chain?: string;
}

interface BunnyAction {
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  source: string;
  push: boolean;
  executeInstructions: string;
  tokens?: TokenRef[];
  createdAt: string;
  status: Status;
}

function shortAddress(addr: string): string {
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function TokensMentioned({ tokens }: { tokens: TokenRef[] }) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  if (!tokens || tokens.length === 0) return null;

  const copy = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-1">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
        {t("actions.tokensMentioned")}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tokens.map((tok, i) => (
          <button
            key={`${tok.address}-${i}`}
            onClick={() => void copy(tok.address)}
            title={t("actions.copyTokenTitle", {
              address: tok.address,
              chain: tok.chain ? ` · ${tok.chain}` : "",
            })}
            className="group/token flex items-center gap-1.5 font-mono text-[10px] border border-border/50 rounded px-1.5 py-0.5 bg-background/40 hover:border-foreground/30 transition-colors"
          >
            <span className="text-foreground">{tok.symbol}</span>
            <span className="text-muted-foreground/70">
              {shortAddress(tok.address)}
            </span>
            {copied === tok.address ? (
              <Check className="h-2.5 w-2.5 text-green" />
            ) : (
              <Copy className="h-2.5 w-2.5 text-muted-foreground/50 group-hover/token:text-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ActionsState {
  actions: BunnyAction[];
}

function relativeTime(iso: string | null, t: TFn): string {
  if (!iso) return t("actions.never");
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return t("actions.justNow");
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t("actions.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("actions.hoursAgo", { n: hours });
  return t("actions.daysAgo", { n: Math.floor(hours / 24) });
}

const KIND_DOT: Record<ActionKind, string> = {
  alert: "text-yellow",
  recommendation: "text-green",
};

export function ActionsPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const setChatInput = useAppStore((s) => s.setChatInput);
  const { setActive, tabs, openTab } = useTabs();

  const { data } = useQuery({
    queryKey: ["/api/actions"],
    queryFn: async (): Promise<ActionsState> => {
      const r = await fetch("/api/actions");
      if (!r.ok) return { actions: [] };
      return (await r.json()) as ActionsState;
    },
    refetchInterval: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/actions"] });
  const openBuilder = () => {
    openTab(ACTIONS_BUILDER_TAB);
    setActive(ACTIONS_BUILDER_TAB.id);
  };
  const openHistory = () => {
    openTab(ACTIONS_HISTORY_TAB);
    setActive(ACTIONS_HISTORY_TAB.id);
  };

  const executeAction = async (a: BunnyAction) => {
    playSound("confirm");
    setChatInput(a.executeInstructions || a.title);
    if (tabs.some((t) => t.id === "chat")) {
      setActive("chat");
    }
    queueMicrotask(() => {
      document.getElementById("chat-input")?.focus();
    });
    await fetch(`/api/actions/${a.id}/execute`, { method: "POST" });
    refresh();
  };

  // "hide" — soft-delete from the live inbox. The row stays in history
  // forever and can be unhidden from the history view. Optimistic: drop the
  // row from the cache immediately so the UI feels instant, then sync with
  // the server in the background and reconcile on error.
  const hideAction = async (a: BunnyAction) => {
    playSound("click");
    await queryClient.cancelQueries({ queryKey: ["/api/actions"] });
    const prev = queryClient.getQueryData<ActionsState>(["/api/actions"]);
    queryClient.setQueryData<ActionsState>(["/api/actions"], (old) =>
      old
        ? {
            ...old,
            actions: old.actions.map((x) =>
              x.id === a.id ? { ...x, status: "dismissed" } : x,
            ),
          }
        : old,
    );
    try {
      const r = await fetch(`/api/actions/${a.id}/dismiss`, { method: "POST" });
      if (!r.ok) throw new Error(`dismiss failed: ${r.status}`);
    } catch {
      // Roll back just this row (not the whole snapshot, which could clobber a
      // concurrent hide) so the failed item reappears.
      queryClient.setQueryData<ActionsState>(["/api/actions"], (old) =>
        old
          ? {
              ...old,
              actions: old.actions.map((x) =>
                x.id === a.id ? { ...x, status: "pending" } : x,
              ),
            }
          : old,
      );
    } finally {
      // Reconcile with server truth. The optimistic update already made the UI
      // feel instant; this background refetch closes the race where the 30s
      // poll could otherwise resurrect the row with pre-dismiss data.
      refresh();
    }
  };

  // "hide all" — clear every pending row from the live inbox in one shot.
  // Same optimistic pattern: empty the inbox instantly, sync in the background,
  // roll back the whole snapshot on error.
  const hideAll = async () => {
    playSound("click");
    await queryClient.cancelQueries({ queryKey: ["/api/actions"] });
    const prev = queryClient.getQueryData<ActionsState>(["/api/actions"]);
    queryClient.setQueryData<ActionsState>(["/api/actions"], (old) =>
      old
        ? {
            ...old,
            actions: old.actions.map((x) =>
              x.status === "pending" ? { ...x, status: "dismissed" } : x,
            ),
          }
        : old,
    );
    try {
      const r = await fetch("/api/actions/dismiss-all", { method: "POST" });
      if (!r.ok) throw new Error(`dismiss-all failed: ${r.status}`);
    } catch {
      if (prev) queryClient.setQueryData(["/api/actions"], prev);
    } finally {
      refresh();
    }
  };

  const pending = (data?.actions ?? []).filter(
    (a) => a.status === "pending" && a.push,
  );
  const recommendations = pending.filter((a) => a.kind === "recommendation");
  const alerts = pending.filter((a) => a.kind === "alert");

  return (
    <div className="h-full flex flex-col border-r border-border bg-background">
      <div className="px-4 py-3 border-b border-border/50 shrink-0 flex items-center justify-between gap-2">
        <h2 className="font-sans text-xs font-medium text-muted-foreground uppercase tracking-widest">
          {t("actions.actionsInbox")}
        </h2>
        <div className="flex items-center gap-1">
          {pending.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={hideAll}
              className="h-7 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              title={t("actions.hideAllTitle")}
            >
              <EyeOff className="h-3 w-3 mr-1" />
              {t("actions.hideAll")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={openBuilder}
            className="h-7 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title={t("actions.builderTitle")}
          >
            <Settings2 className="h-3 w-3 mr-1" />
            {t("actions.builder")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={openHistory}
            className="h-7 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title={t("actions.historyTitle")}
          >
            <History className="h-3 w-3 mr-1" />
            {t("actions.history")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        <ActionSection
          label={t("actions.recommendations")}
          sublabel={t("actions.recommendationsSublabel")}
          items={recommendations}
          executable
          emptyHint={t("actions.recommendationsEmpty")}
          onExecute={executeAction}
          onHide={hideAction}
        />
        <ActionSection
          label={t("actions.alerts")}
          sublabel={t("actions.alertsSublabel")}
          items={alerts}
          executable={false}
          emptyHint={t("actions.alertsEmpty")}
          onExecute={executeAction}
          onHide={hideAction}
        />
      </div>
    </div>
  );
}

function ActionSection({
  label,
  items,
  executable,
  emptyHint,
  onExecute,
  onHide,
}: {
  label: string;
  sublabel: string;
  items: BunnyAction[];
  executable: boolean;
  emptyHint: string;
  onExecute: (a: BunnyAction) => void;
  onHide: (a: BunnyAction) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="px-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
          {label}
          <span className="ml-1.5 text-muted-foreground">({items.length})</span>
        </span>
      </div>
      {items.length === 0 && (
        <div className="border border-dashed border-border/60 rounded-md px-3 py-4 text-center">
          <span className="font-mono text-[10px] text-muted-foreground/70 leading-relaxed">
            {emptyHint}
          </span>
        </div>
      )}
      {items.map((a) => (
        <div
          key={a.id}
          className="border border-border rounded-md p-3 bg-foreground/5 space-y-2 group"
        >
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "font-mono text-sm leading-none mt-0.5",
                KIND_DOT[a.kind],
              )}
            >
              ●
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-foreground font-medium leading-snug">
                {a.title}
              </div>
              <div
                className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate"
                title={a.source}
              >
                {t("actions.fromSource", { source: a.source })}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
                {relativeTime(a.createdAt, t)}
              </div>
            </div>
            <button
              onClick={() => onHide(a)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 -m-0.5"
              aria-label={t("actions.hide")}
              title={t("actions.hideFromInbox")}
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </div>
          <div className="font-mono text-[11px] text-foreground/80 leading-relaxed break-words">
            {a.description}
          </div>
          {a.tokens && a.tokens.length > 0 && (
            <TokensMentioned tokens={a.tokens} />
          )}
          {executable && a.executeInstructions && (
            <div className="font-mono text-[10px] text-muted-foreground/80 bg-background/40 border border-border/40 rounded px-2 py-1 leading-relaxed break-words">
              <span className="text-muted-foreground">{t("actions.executeLabel")}</span>{" "}
              <span className="text-foreground/80">{a.executeInstructions}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {executable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onExecute(a)}
                className="h-6 px-2 font-mono text-[10px]"
                title={t("actions.executeInstructionsTitle")}
              >
                <Play className="h-2.5 w-2.5 mr-1" />
                {t("actions.execute")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onHide(a)}
              className="h-6 px-2 font-mono text-[10px] text-muted-foreground"
              title={t("actions.hideFromInbox")}
            >
              {t("actions.hide")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
