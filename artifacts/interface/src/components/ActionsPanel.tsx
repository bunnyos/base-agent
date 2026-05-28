import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/sound";
import { useTabs } from "./TabsContext";
const ACTIONS_BUILDER_TAB_ID = "actions-builder";
const ACTIONS_HISTORY_TAB: {
  id: "actions-history";
  title: string;
  kind: "actions-history";
  closable: boolean;
} = {
  id: "actions-history",
  title: "actions history",
  kind: "actions-history",
  closable: true,
};
import { EyeOff, History, Play, Settings2 } from "lucide-react";

type ActionKind = "alert" | "recommendation";
type Status = "pending" | "executed" | "dismissed";

interface BunnyAction {
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  source: string;
  push: boolean;
  executeInstructions: string;
  createdAt: string;
  status: Status;
}

interface ActionsState {
  actions: BunnyAction[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const KIND_DOT: Record<ActionKind, string> = {
  alert: "text-yellow",
  recommendation: "text-green",
};

export function ActionsPanel() {
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
  const openBuilder = () => setActive(ACTIONS_BUILDER_TAB_ID);
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
  // forever and can be unhidden from the history view.
  const hideAction = async (a: BunnyAction) => {
    playSound("click");
    await fetch(`/api/actions/${a.id}/dismiss`, { method: "POST" });
    refresh();
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
          actions
        </h2>
        <button
          onClick={openHistory}
          className="font-mono text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          title="see every action ever posted, including hidden ones"
        >
          <History className="h-3 w-3" />
          history
        </button>
      </div>

      <div className="border-b border-border/50 shrink-0">
        <button
          onClick={openBuilder}
          className="w-full px-4 py-2 flex items-center gap-2 hover:bg-foreground/5 text-left"
        >
          <Settings2 className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-[11px] text-muted-foreground flex-1">
            actions builder
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            manage →
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        <ActionSection
          label="recommendations"
          sublabel="suggested moves you can execute"
          items={recommendations}
          executable
          emptyHint="nothing to act on yet — your actions will surface one-click recommendations here."
          onExecute={executeAction}
          onHide={hideAction}
        />
        <ActionSection
          label="alerts"
          sublabel="heads-up only — no action required"
          items={alerts}
          executable={false}
          emptyHint="no alerts. your actions will post warnings + info here when conditions trigger."
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
                from: {a.source}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
                {relativeTime(a.createdAt)}
              </div>
            </div>
            <button
              onClick={() => onHide(a)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-0.5 -m-0.5"
              aria-label="hide"
              title="hide from inbox — kept in history"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </div>
          <div className="font-mono text-[11px] text-foreground/80 leading-relaxed">
            {a.description}
          </div>
          {executable && a.executeInstructions && (
            <div className="font-mono text-[10px] text-muted-foreground/80 bg-background/40 border border-border/40 rounded px-2 py-1 leading-relaxed">
              <span className="text-muted-foreground">execute:</span>{" "}
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
                title="fill the chat with the execute instructions"
              >
                <Play className="h-2.5 w-2.5 mr-1" />
                execute
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onHide(a)}
              className="h-6 px-2 font-mono text-[10px] text-muted-foreground"
              title="hide from inbox — kept in history"
            >
              hide
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
