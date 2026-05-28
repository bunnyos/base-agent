import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useGetBaseMcpStatus } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTabs } from "./TabsContext";

type Wallets = {
  baseAccount?: { address?: string };
  agentWallets?: Array<{ address?: string }>;
  supportedChains?: string[];
};

type PortfolioAsset = {
  symbol?: string;
  name?: string;
  chain?: string;
  balance?: string | number;
  usdValue?: string | number;
  iconUrl?: string;
};

type Portfolio = {
  address?: string;
  totalUsdValue?: string;
  assets?: PortfolioAsset[];
};

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

function StatusRow({
  p,
  onOpen,
}: {
  p: ProtocolStatus;
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
      className="flex items-center justify-between py-0.5 gap-2"
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
        <span className={`font-sans text-xs truncate ${nameColor}`}>
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
    </div>
  );
}

async function mcpCall<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  const r = await fetch("/api/base-mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  if (!r.ok) return null;
  const body = (await r.json()) as { parsed?: T };
  return (body.parsed ?? null) as T | null;
}

export function WalletPortfolioPanel() {
  const { toast } = useToast();
  const { openTab } = useTabs();
  const openConfigure = () =>
    openTab({ id: "settings", title: "configure", kind: "settings", closable: false });
  const openProtocolTab = (p: ProtocolStatus) =>
    openTab({
      id: `protocol:${p.id}`,
      title: p.label,
      kind: "protocol",
      payload: { protocolId: p.id },
    });
  const { data: mcpStatus } = useGetBaseMcpStatus({
    query: { queryKey: ["/api/base-mcp/status"], refetchInterval: 10000 },
  });
  const isConnected = Boolean(mcpStatus?.connected);
  const BASE_APP_URL = "https://account.base.app/";

  const { data: protocolsData } = useQuery({
    queryKey: ["/api/protocols"],
    queryFn: async (): Promise<{ protocols: ProtocolStatus[] }> => {
      const r = await fetch("/api/protocols");
      if (!r.ok) return { protocols: [] };
      return (await r.json()) as { protocols: ProtocolStatus[] };
    },
    refetchInterval: 15_000,
  });
  const protocols = protocolsData?.protocols;

  const { data: wallets, isLoading: loadingWallets } = useQuery({
    queryKey: ["mcp", "get_wallets"],
    queryFn: () => mcpCall<Wallets>("get_wallets"),
    enabled: isConnected,
    staleTime: 30_000,
  });

  const {
    data: portfolio,
    isLoading: loadingPortfolio,
    refetch: refetchPortfolio,
  } = useQuery({
    queryKey: ["mcp", "get_portfolio"],
    queryFn: () => mcpCall<Portfolio>("get_portfolio", { limit: 20 }),
    enabled: isConnected,
    staleTime: 30_000,
  });

  const baseAddress = wallets?.baseAccount?.address;

  const handleConnect = () => {
    // Top-level navigation in the popup so the bunny_anon cookie persists
    // even when the app is inside a cross-site preview iframe (third-party
    // cookie blocking strips cookies set on iframe-fetch responses).
    window.open(
      "/api/base-mcp/connect-start",
      "base-mcp-auth",
      "width=520,height=720",
    );
  };

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ description: `${label} copied`, duration: 2000 });
  };

  const shortAddr = (a?: string) =>
    a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

  return (
    <div className="h-full flex flex-col border-r border-border bg-surface overflow-y-auto">
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <span className="font-sans text-xs font-medium text-muted-foreground uppercase tracking-widest">
            wallet
          </span>
        </div>

        {!isConnected ? (
          <div className="space-y-2">
            <button
              onClick={handleConnect}
              className="w-full px-3 py-2 bg-accent text-accent-foreground hover:opacity-90 rounded font-sans text-sm font-medium transition-opacity disabled:opacity-50"
              data-testid="button-connect-base"
            >
              connect base account
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="font-sans text-xl sm:text-2xl font-semibold tracking-tight">
                ${portfolio?.totalUsdValue ?? "0.00"}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => baseAddress && handleCopy(baseAddress, "Address")}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  data-testid="button-copy-address"
                >
                  {loadingWallets ? "loading…" : shortAddr(baseAddress)}
                  <Copy className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={() => refetchPortfolio()}
                  className="text-muted-foreground hover:text-foreground"
                  title="Refresh"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
            </div>

            {baseAddress && (
              <button
                onClick={() =>
                  openExternal(`https://debank.com/profile/${baseAddress}`)
                }
                className="w-full px-3 py-2 mb-2 bg-foreground/10 hover:bg-foreground/20 rounded font-sans text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5"
                data-testid="button-defi-debank"
                title="view lending, staking, and lp positions on debank"
              >
                defi positions
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => openExternal(BASE_APP_URL)}
              className="w-full px-3 py-2 bg-accent text-accent-foreground hover:opacity-90 rounded font-sans text-xs font-medium transition-opacity inline-flex items-center justify-center gap-1.5"
              data-testid="button-manage-base-account"
              title="open base account for buy / send / swap / receive / settings"
            >
              manage in base account
              <ExternalLink className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      <div className="p-4 flex-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-sans text-xs font-medium text-muted-foreground uppercase tracking-widest">
            status
          </h2>
          <button
            type="button"
            onClick={openConfigure}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            configure ›
          </button>
        </div>
        {(() => {
          const all = protocols ?? [];
          const mcp = all.filter((p) => p.source === "mcp");
          const api = all.filter((p) => p.source === "api");
          return (
            <div className="space-y-4">
              {mcp.length > 0 && (
                <div>
                  <h3 className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    mcp
                  </h3>
                  <div className="space-y-0.5">
                    {mcp.map((p) => (
                      <StatusRow key={p.id} p={p} onOpen={openProtocolTab} />
                    ))}
                  </div>
                </div>
              )}
              {api.length > 0 && (
                <div>
                  <h3 className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    bunnyOS implementation
                  </h3>
                  <div className="space-y-0.5">
                    {api.map((p) => (
                      <StatusRow key={p.id} p={p} onOpen={openProtocolTab} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
