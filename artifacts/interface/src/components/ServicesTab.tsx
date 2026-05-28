import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTabs } from "./TabsContext";

type ProtocolStatus = {
  id: string;
  label: string;
  kind: string;
  connected: boolean;
  toolCount: number;
  requiresAuth: boolean;
  enabled: boolean;
  source: "mcp" | "api";
  via?: string;
  error?: string;
};

function ProtocolRow({
  p,
  onToggle,
  onOpen,
}: {
  p: ProtocolStatus;
  onToggle: (id: string, enabled: boolean) => void;
  onOpen: (p: ProtocolStatus) => void;
}) {
  const status: "connected" | "available" | "error" | "off" = !p.enabled
    ? "off"
    : p.error
      ? "error"
      : p.connected
        ? "connected"
        : "available";
  const dotColor =
    status === "connected"
      ? "bg-green"
      : status === "error"
        ? "bg-destructive/70"
        : status === "off"
          ? "bg-muted-foreground/20"
          : "bg-muted-foreground/40";
  const nameColor =
    status === "connected" ? "text-foreground" : "text-muted-foreground";
  const meta = !p.enabled
    ? "off"
    : p.connected
      ? `${p.toolCount} tools`
      : p.requiresAuth
        ? "not authorized"
        : p.error
          ? "offline"
          : p.kind;
  return (
    <div
      className="flex items-center justify-between py-1.5 gap-2 border-b border-border/40 last:border-b-0"
      title={p.error ?? `${p.label} · ${p.kind}`}
    >
      <button
        type="button"
        onClick={() => onOpen(p)}
        className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity cursor-pointer"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`}
        />
        <span className={`font-sans text-sm truncate ${nameColor}`}>
          {p.label}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onOpen(p)}
        className="font-mono text-[10px] text-muted-foreground shrink-0 hover:text-foreground transition-colors cursor-pointer"
      >
        {meta}
      </button>
      <Switch
        checked={p.enabled}
        onCheckedChange={(v) => onToggle(p.id, v)}
        className="shrink-0 scale-75 -mr-1"
        aria-label={`toggle ${p.label}`}
      />
    </div>
  );
}

export function ServicesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { openTab } = useTabs();

  const { data: protocolsData } = useQuery({
    queryKey: ["/api/protocols"],
    queryFn: async (): Promise<{ protocols: ProtocolStatus[] }> => {
      const r = await fetch("/api/protocols");
      if (!r.ok) return { protocols: [] };
      return (await r.json()) as { protocols: ProtocolStatus[] };
    },
    refetchInterval: 15_000,
  });
  const protocols = protocolsData?.protocols ?? [];
  const mcp = protocols.filter((p) => p.source === "mcp");
  const api = protocols.filter((p) => p.source === "api");

  const openProtocolTab = (p: ProtocolStatus) =>
    openTab({
      id: `protocol:${p.id}`,
      title: p.label,
      kind: "protocol",
      payload: { protocolId: p.id },
    });

  const toggleProtocol = (id: string, enabled: boolean) => {
    queryClient.setQueryData<{ protocols: ProtocolStatus[] }>(
      ["/api/protocols"],
      (old) =>
        old
          ? {
              protocols: old.protocols.map((p) =>
                p.id === id ? { ...p, enabled } : p,
              ),
            }
          : old,
    );
    void fetch(`/api/protocols/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => {
      toast({
        description: `Failed to toggle ${id}`,
        duration: 2000,
        variant: "destructive",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/protocols"] });
    });
  };

  return (
    <div className="space-y-5">
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        toggle which protocols + apis bunnyOS can call. enabled ones are
        advertised to the agent on every turn; disabled ones are hidden. click
        a row to open it in a tab.
      </p>

      {mcp.length > 0 && (
        <div>
          <h3 className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            mcp
          </h3>
          <div>
            {mcp.map((p) => (
              <ProtocolRow
                key={p.id}
                p={p}
                onToggle={toggleProtocol}
                onOpen={openProtocolTab}
              />
            ))}
          </div>
        </div>
      )}

      {api.length > 0 && (
        <div>
          <h3 className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            bunnyOS implementation
          </h3>
          <div>
            {api.map((p) => (
              <ProtocolRow
                key={p.id}
                p={p}
                onToggle={toggleProtocol}
                onOpen={openProtocolTab}
              />
            ))}
          </div>
        </div>
      )}

      {protocols.length === 0 && (
        <div className="text-[11px] text-muted-foreground">
          loading services…
        </div>
      )}
    </div>
  );
}
