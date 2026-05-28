import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download, Loader2, Play, Plus, Trash2, Upload } from "lucide-react";
import { playSound } from "@/lib/sound";

interface ActionDraft {
  name: string;
  enabled: boolean;
  intervalMs: number;
  instructions: string;
  toolAllowlist: string[] | null;
}

const EXPORT_TYPE = "bunnyos.action";
const EXPORT_VERSION = 1;

function toDraft(a: Action): ActionDraft {
  return {
    name: a.name,
    enabled: a.enabled,
    intervalMs: a.intervalMs,
    instructions: a.instructions,
    toolAllowlist: a.toolAllowlist,
  };
}

function coerceDraft(raw: unknown): ActionDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o["name"] === "string" ? o["name"] : null;
  const intervalMs =
    typeof o["intervalMs"] === "number" ? o["intervalMs"] : null;
  const instructions =
    typeof o["instructions"] === "string" ? o["instructions"] : "";
  if (name === null || intervalMs === null) return null;
  const enabled = o["enabled"] === true;
  const allow = o["toolAllowlist"];
  const toolAllowlist =
    allow === null
      ? null
      : Array.isArray(allow) && allow.every((x) => typeof x === "string")
        ? (allow as string[])
        : null;
  return { name, enabled, intervalMs, instructions, toolAllowlist };
}

function parseImport(text: string): ActionDraft {
  const parsed = JSON.parse(text) as unknown;
  let candidate: unknown = parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (o["action"] && typeof o["action"] === "object") candidate = o["action"];
  }
  const draft = coerceDraft(candidate);
  if (!draft)
    throw new Error("invalid action: expected an object with name + intervalMs");
  return draft;
}

function sanitizeFilename(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "action";
}

function downloadAction(action: Action): void {
  const payload = {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    action: toDraft(action),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bunnyos-action-${sanitizeFilename(action.name)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface Action {
  id: string;
  name: string;
  enabled: boolean;
  intervalMs: number;
  instructions: string;
  toolAllowlist: string[] | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  createdAt: string;
}

interface ToolEntry {
  protocol: string;
  name: string;
  description: string;
}

interface ActionsResponse {
  workflows: Action[];
  tools: ToolEntry[];
  allowedIntervalsMs: number[];
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

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

const PLACEHOLDER_INSTRUCTIONS = `examples:

• alert me if my USDC supply APY on aave-base drops below 4%.
• every hour, check my wallet's net pnl. if it moves more than 5% since last check, post an info alert.
• if any of my morpho positions is within 10% of liquidation, post a critical alert and recommend repaying the smallest amount that pushes it back above 25% buffer.
• scan top 5 yield opportunities for USDC on base via defi llama. if any beats my current best by >100 bps, recommend moving 100 USDC into it.`;

export function ActionsBuilderView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["/api/workflows"],
    queryFn: async (): Promise<ActionsResponse> => {
      const r = await fetch("/api/workflows");
      if (!r.ok) throw new Error("failed to load actions");
      return (await r.json()) as ActionsResponse;
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(
    () => data?.workflows.find((w) => w.id === editingId) ?? null,
    [data, editingId],
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });

  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      let draft: ActionDraft;
      try {
        draft = parseImport(text);
      } catch (err) {
        toast({
          title: "import failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return;
      }
      const r = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) {
        toast({
          title: "import failed",
          description: await r.text(),
          variant: "destructive",
        });
        return;
      }
      const j = (await r.json()) as { workflow: Action };
      await refresh();
      setEditingId(j.workflow.id);
      toast({ title: "imported", description: draft.name });
    } finally {
      setImporting(false);
    }
  };

  const createNew = () => {
    playSound("confirm");
    const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`;
    const optimistic: Action = {
      id: tempId,
      name: "new action",
      enabled: false,
      intervalMs: 600_000,
      instructions: "",
      toolAllowlist: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      createdAt: new Date().toISOString(),
    };
    queryClient.setQueryData<ActionsResponse>(["/api/workflows"], (prev) =>
      prev
        ? { ...prev, workflows: [optimistic, ...prev.workflows] }
        : prev,
    );
    setEditingId(tempId);
    void (async () => {
      try {
        const r = await fetch("/api/workflows", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: optimistic.name,
            enabled: optimistic.enabled,
            intervalMs: optimistic.intervalMs,
            instructions: optimistic.instructions,
            toolAllowlist: optimistic.toolAllowlist,
          }),
        });
        if (!r.ok) throw new Error(await r.text());
        const j = (await r.json()) as { workflow: Action };
        queryClient.setQueryData<ActionsResponse>(
          ["/api/workflows"],
          (prev) =>
            prev
              ? {
                  ...prev,
                  workflows: prev.workflows.map((w) =>
                    w.id === tempId ? j.workflow : w,
                  ),
                }
              : prev,
        );
        setEditingId((curr) => (curr === tempId ? j.workflow.id : curr));
      } catch (err) {
        queryClient.setQueryData<ActionsResponse>(
          ["/api/workflows"],
          (prev) =>
            prev
              ? {
                  ...prev,
                  workflows: prev.workflows.filter((w) => w.id !== tempId),
                }
              : prev,
        );
        setEditingId((curr) => (curr === tempId ? null : curr));
        toast({
          title: "create failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    })();
  };


  return (
    <div className="flex-1 flex flex-col md:flex-row w-full min-h-0">
      <div
        className={`w-full md:w-[280px] shrink-0 border-b md:border-b-0 md:border-r border-border flex-col bg-background ${
          editing ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between gap-1">
          <h2 className="font-sans text-xs font-medium text-muted-foreground uppercase tracking-widest">
            actions
          </h2>
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={onImportClick}
              disabled={importing}
              title="import action from json"
              className="h-7 w-7 p-0 font-mono text-[11px]"
            >
              {importing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={createNew}
              className="h-7 px-2 font-mono text-[11px]"
            >
              <Plus className="h-3 w-3 mr-1" />
              new
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            className="hidden"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-4 py-6 font-mono text-[11px] text-muted-foreground">
              loading…
            </div>
          )}
          {!isLoading && (data?.workflows.length ?? 0) === 0 && (
            <div className="px-4 py-8 font-mono text-[11px] text-muted-foreground leading-relaxed">
              no actions yet. click <span className="text-foreground">new</span>{" "}
              to create one.
            </div>
          )}
          {data?.workflows.map((w) => (
            <button
              key={w.id}
              onClick={() => setEditingId(w.id)}
              className={`w-full px-4 py-3 border-b border-border/30 text-left hover:bg-foreground/5 ${
                editingId === w.id ? "bg-foreground/10" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono ${
                    w.enabled ? "text-green" : "text-muted-foreground/50"
                  }`}
                >
                  ●
                </span>
                <span className="font-mono text-xs text-foreground truncate flex-1">
                  {w.name || "untitled"}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground flex items-center gap-2">
                <span>every {formatInterval(w.intervalMs)}</span>
                <span>·</span>
                <span>
                  {w.toolAllowlist === null
                    ? "all tools"
                    : `${w.toolAllowlist.length} tools`}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                last run: {relativeTime(w.lastRunAt)}
                {w.lastRunStatus ? ` (${w.lastRunStatus})` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div
        className={`flex-1 min-w-0 overflow-y-auto bg-background ${
          editing ? "block" : "hidden md:block"
        }`}
      >
        {editing ? (
          <ActionEditor
            key={editing.id}
            action={editing}
            tools={data?.tools ?? []}
            allowedIntervalsMs={data?.allowedIntervalsMs ?? [600_000]}
            onSaved={refresh}
            onBack={() => setEditingId(null)}
            onDeleted={() => {
              setEditingId(null);
              void refresh();
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <div className="space-y-2 max-w-md">
              <div className="font-sans text-lg text-foreground">
                actions builder
              </div>
              <div className="font-mono text-[11px] text-muted-foreground leading-relaxed">
                each action is a scoped agent that runs on a schedule. write
                what you want it to watch for, pick which tools it may call,
                and it will post alerts and one-click recommendations into your
                inbox.
              </div>
              <div className="font-mono text-[11px] text-muted-foreground leading-relaxed pt-2">
                pick an action on the left to edit, or click{" "}
                <span className="text-foreground">new</span>.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionEditor({
  action,
  tools,
  allowedIntervalsMs,
  onSaved,
  onDeleted,
  onBack,
}: {
  action: Action;
  tools: ToolEntry[];
  allowedIntervalsMs: number[];
  onSaved: () => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(action.name);
  const [enabled, setEnabled] = useState(action.enabled);
  const [intervalMs, setIntervalMs] = useState(action.intervalMs);
  const [instructions, setInstructions] = useState(action.instructions);
  // null = "all tools" (no allowlist); Set = explicit allowlist.
  const [allowSet, setAllowSet] = useState<Set<string> | null>(
    action.toolAllowlist === null ? null : new Set(action.toolAllowlist),
  );
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setName(action.name);
    setEnabled(action.enabled);
    setIntervalMs(action.intervalMs);
    setInstructions(action.instructions);
    setAllowSet(
      action.toolAllowlist === null ? null : new Set(action.toolAllowlist),
    );
  }, [action.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const m = new Map<string, ToolEntry[]>();
    for (const t of tools) {
      const arr = m.get(t.protocol) ?? [];
      arr.push(t);
      m.set(t.protocol, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);

  const useAll = allowSet === null;
  const isToolEnabled = (name: string) => useAll || allowSet!.has(name);
  const totalTools = tools.length;
  const enabledCount = useAll ? totalTools : allowSet!.size;

  const toggleAll = (on: boolean) => {
    setAllowSet(on ? null : new Set());
  };

  const toggleProtocol = (protocol: string, on: boolean) => {
    const next = new Set(useAll ? tools.map((t) => t.name) : allowSet!);
    for (const t of tools) {
      if (t.protocol !== protocol) continue;
      if (on) next.add(t.name);
      else next.delete(t.name);
    }
    setAllowSet(next);
  };

  const toggleTool = (toolName: string) => {
    const next = new Set(useAll ? tools.map((t) => t.name) : allowSet!);
    if (next.has(toolName)) next.delete(toolName);
    else next.add(toolName);
    setAllowSet(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/workflows/${action.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          enabled,
          intervalMs,
          instructions,
          toolAllowlist: useAll ? null : [...allowSet!],
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "save failed",
          description: j.error ?? `${r.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "saved" });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await fetch(`/api/workflows/${action.id}/run`, {
        method: "POST",
      });
      const j = (await r.json().catch(() => ({}))) as {
        result?: {
          status: string;
          emitted: { kind: string; title: string; deduped: boolean }[];
          note?: string;
          error?: string;
        };
        error?: string;
      };
      if (!r.ok) {
        toast({
          title: r.status === 429 ? "rate limited" : "run failed",
          description: j.error ?? `${r.status}`,
          variant: "destructive",
        });
        return;
      }
      if (j.result) {
        const lines = j.result.emitted.map(
          (e) =>
            `${e.kind}: ${e.title}${e.deduped ? " (deduped)" : ""}`,
        );
        const summary =
          lines.length > 0
            ? lines.join("\n")
            : j.result.note || j.result.error || "no findings";
        toast({
          title: `run ${j.result.status} · ${j.result.emitted.length} emitted`,
          description: summary.slice(0, 300),
        });
      }
      onSaved();
    } finally {
      setRunning(false);
    }
  };

  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    if (action.id.startsWith("tmp_")) {
      onDeleted();
      return;
    }
    setDeleting(true);
    try {
      const r = await fetch(`/api/workflows/${action.id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        toast({
          title: "delete failed",
          description: await r.text(),
          variant: "destructive",
        });
        return;
      }
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-6">
      <button
        onClick={onBack}
        className="md:hidden font-mono text-[11px] text-muted-foreground hover:text-foreground -mt-1 -ml-1 px-1"
      >
        ← actions
      </button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            name
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-mono text-sm"
            placeholder="my action"
          />
        </div>
        <div className="space-y-1">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            every
          </Label>
          <Select
            value={String(intervalMs)}
            onValueChange={(v) => setIntervalMs(Number(v))}
          >
            <SelectTrigger className="w-full sm:w-[110px] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedIntervalsMs.map((ms) => (
                <SelectItem
                  key={ms}
                  value={String(ms)}
                  className="font-mono text-xs"
                >
                  {formatInterval(ms)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="font-mono text-xs text-muted-foreground">
            {enabled ? "enabled" : "paused"}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          instructions
        </Label>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={PLACEHOLDER_INSTRUCTIONS}
          className="font-mono text-[12px] min-h-[200px] leading-relaxed"
        />
        <div className="font-mono text-[10px] text-muted-foreground/70 leading-relaxed">
          write what to watch for, when to alert, and when to recommend. the
          agent gathers data with the tools below, then posts <span className="text-foreground">alerts</span> (fyi)
          and <span className="text-foreground">recommendations</span> (one-click execute) to your inbox.
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            tools the agent may use
          </Label>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {enabledCount} / {totalTools}
            </span>
            <Switch checked={useAll} onCheckedChange={toggleAll} />
            <span className="font-mono text-[10px] text-muted-foreground">
              all
            </span>
          </div>
        </div>
        {totalTools === 0 && (
          <div className="border border-dashed border-border/60 rounded-md p-4 text-center font-mono text-[10px] text-muted-foreground">
            no tools available — enable some protocols in configure → services.
          </div>
        )}
        {grouped.map(([protocol, entries]) => {
          const enabledInProtocol = entries.filter((t) =>
            isToolEnabled(t.name),
          ).length;
          const allOn = enabledInProtocol === entries.length;
          return (
            <div
              key={protocol}
              className="border border-border/60 rounded-md p-2 space-y-2"
            >
              <div className="flex items-center justify-between px-1">
                <div className="font-mono text-[10px] uppercase tracking-widest text-foreground/70">
                  {protocol}
                  <span className="ml-1.5 text-muted-foreground">
                    ({enabledInProtocol}/{entries.length})
                  </span>
                </div>
                <button
                  onClick={() => toggleProtocol(protocol, !allOn)}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {allOn ? "none" : "all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {entries.map((t) => {
                  const on = isToolEnabled(t.name);
                  return (
                    <button
                      key={t.name}
                      onClick={() => toggleTool(t.name)}
                      title={t.description}
                      className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        on
                          ? "bg-foreground/10 border-foreground/30 text-foreground"
                          : "bg-transparent border-border/40 text-muted-foreground/60 hover:text-foreground"
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
        <Button onClick={save} disabled={saving} className="font-mono text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          save
        </Button>
        <Button
          variant="outline"
          onClick={runNow}
          disabled={running || !instructions.trim()}
          className="font-mono text-xs"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Play className="h-3 w-3 mr-1" />
          )}
          run now
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          onClick={() => downloadAction(action)}
          disabled={action.id.startsWith("tmp_")}
          title="export this action as json"
          className="font-mono text-xs"
        >
          <Upload className="h-3 w-3 mr-1" />
          export
        </Button>
        <Button
          variant="ghost"
          onClick={remove}
          disabled={deleting}
          className="font-mono text-xs text-destructive hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Trash2 className="h-3 w-3 mr-1" />
          )}
          delete
        </Button>
      </div>
      {action.lastRunError && (
        <div className="font-mono text-[10px] text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          last error: {action.lastRunError}
        </div>
      )}
    </div>
  );
}
