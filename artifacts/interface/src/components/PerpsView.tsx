import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useT, useLang } from "@/i18n";
import { useAppStore } from "@/lib/store";
import { useTabs } from "./TabsContext";
import { PerpsTaPanel } from "./PerpsTaPanel";

// Avantis prices come from Pyth feeds, so the PYTH:<BASE><QUOTE> namespace is
// the most consistent TradingView symbol for any listed pair (crypto, FX,
// metals). e.g. "ETH/USD" -> "PYTH:ETHUSD".
function tvSymbol(pair: string): string {
  return `PYTH:${pair.replace(/\s/g, "").replace(/\//g, "").toUpperCase()}`;
}

// Light-mode TradingView advanced chart, re-injected whenever the symbol
// changes. UI-only embed (no market data flows through it), consistent with the
// existing GeckoTerminal chart in the token report.
function TradingViewChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML =
      '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "60",
      timezone: "Etc/UTC",
      theme: "light",
      style: "1",
      locale: "en",
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
    };
  }, [symbol]);
  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{ height: "100%", width: "100%" }}
    />
  );
}

type MarketPair = {
  index: number;
  pair: string;
  minLeverage?: number;
  maxLeverage?: number;
  openInterest?: { long?: number; short?: number };
  pairOI?: number;
  pairMaxOI?: number;
  spreadP?: number;
  openFeeP?: number;
  closeFeeP?: number;
  minPositionUSDC?: number;
  feedId?: string;
};

type MarketsResp = { count: number; totalOpenInterest?: number; pairs: MarketPair[] };

type PriceRow = {
  pair?: string;
  index?: number;
  price?: number | null;
  publishTime?: number;
  query?: string;
  error?: string;
};
type PricesResp = { prices: PriceRow[] };

type PositionView = {
  pairIndex: number | null;
  index: number | null;
  pair: string | null;
  side: "long" | "short" | null;
  leverage: number | null;
  collateralUsdc: number | null;
  notionalUsdc: number | null;
  pnlUsdc: number | null;
};
type PositionsResp = {
  wallet?: string;
  needsWallet?: boolean;
  openPositions?: number;
  pendingLimitOrders?: number;
  positions: PositionView[];
  limitOrders: unknown[];
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `request failed (${r.status})`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return (await r.json()) as T;
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(3)}%`;
}

function Card({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("rounded border border-border bg-card", className)}>
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
          {title}
        </span>
        {right}
      </div>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </div>
  );
}

function SideBadge({ side, t }: { side: "long" | "short" | null; t: ReturnType<typeof useT> }) {
  if (!side) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase",
        side === "long" ? "bg-green/15 text-green" : "bg-destructive/15 text-destructive",
      )}
    >
      {side === "long" ? t("perps.long") : t("perps.short")}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-xs text-foreground truncate">{value}</div>
    </div>
  );
}

export function PerpsView() {
  const t = useT();
  const { lang } = useLang();
  const setChatInput = useAppStore((s) => s.setChatInput);
  const { tabs, setActive } = useTabs();

  const markets = useQuery({
    queryKey: ["/api/perps/markets"],
    queryFn: () => getJson<MarketsResp>("/api/perps/markets"),
    staleTime: 60_000,
    retry: false,
  });

  const positions = useQuery({
    queryKey: ["/api/perps/positions"],
    queryFn: () => getJson<PositionsResp>("/api/perps/positions"),
    refetchInterval: 20_000,
    retry: false,
  });

  const pairList = useMemo(
    () => (markets.data?.pairs ?? []).map((p) => p.pair),
    [markets.data],
  );
  const pairsKey = pairList.join(",");

  const prices = useQuery({
    queryKey: ["/api/perps/prices", pairsKey],
    queryFn: () =>
      getJson<PricesResp>(`/api/perps/prices?pairs=${encodeURIComponent(pairsKey)}`),
    enabled: pairList.length > 0,
    refetchInterval: 10_000,
    retry: false,
  });

  const priceByPair = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of prices.data?.prices ?? []) {
      if (row.pair && typeof row.price === "number") m.set(row.pair, row.price);
    }
    return m;
  }, [prices.data]);

  // ---- open form state ----
  const [pair, setPair] = useState<string>("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [collateral, setCollateral] = useState<string>("");
  const [leverage, setLeverage] = useState<string>("2");

  const selectedPair = useMemo(
    () => (markets.data?.pairs ?? []).find((p) => p.pair === (pair || pairList[0])),
    [markets.data, pair, pairList],
  );
  const activePairLabel = selectedPair?.pair ?? pairList[0] ?? "";
  const minLev = selectedPair?.minLeverage ?? 1;
  const maxLev = selectedPair?.maxLeverage ?? 100;
  const minPos = selectedPair?.minPositionUSDC ?? 100;

  const collN = Number(collateral);
  const levN = Number(leverage);
  const notional =
    Number.isFinite(collN) && Number.isFinite(levN) ? collN * levN : null;
  const validOpen =
    Number.isFinite(collN) &&
    collN > 0 &&
    Number.isFinite(levN) &&
    levN >= minLev &&
    levN <= maxLev &&
    notional !== null &&
    notional >= minPos;

  const switchToChat = () => {
    // Mobile has a dedicated chat tab; desktop keeps chat inside the home
    // 3-column layout. Prefer the chat tab, fall back to home so the prefilled
    // message is always visible after handoff.
    const chatTab = tabs.find((tb) => tb.kind === "chat" && !tb.hidden);
    setActive(chatTab ? chatTab.id : "home");
  };

  const handleReviewOpen = () => {
    if (!validOpen || !activePairLabel) return;
    setChatInput(
      `open a ${leverage}x ${side} on ${activePairLabel} with ${collateral} USDC`,
    );
    switchToChat();
  };

  const handleClose = (p: PositionView) => {
    if (!p.pair || p.index === null) return;
    setChatInput(`close my ${p.pair} perp position (index ${p.index})`);
    switchToChat();
  };

  const disabled =
    (markets.error as (Error & { status?: number }) | null)?.status === 403;

  if (disabled) {
    return (
      <div className="flex-1 w-full min-h-0 flex items-center justify-center p-6 text-center">
        <p className="font-mono text-xs text-muted-foreground">
          {t("perps.disabled")}
        </p>
      </div>
    );
  }

  const livePrice = activePairLabel ? priceByPair.get(activePairLabel) ?? null : null;

  return (
    <div className="flex-1 w-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1800px] space-y-3 p-3 sm:p-4">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-sm font-semibold lowercase text-foreground">
              {t("perps.title")}
            </h1>
            <p className="font-mono text-[10px] text-muted-foreground">
              {t("perps.poweredBy")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void markets.refetch();
              void positions.refetch();
              void prices.refetch();
            }}
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw
              className={cn("h-3 w-3", (markets.isFetching || positions.isFetching) && "animate-spin")}
            />
            {t("perps.refresh")}
          </button>
        </div>

        {/* chart (wide) + open position (narrow) */}
        <div
          className={cn(
            "grid gap-3",
            activePairLabel && "lg:grid-cols-12 lg:grid-rows-[556px_auto]",
          )}
        >
          {activePairLabel && (
            <Card
              title={`${t("perps.chart")} · ${activePairLabel}`}
              className="lg:order-1 lg:col-span-6 lg:flex lg:flex-col"
              bodyClassName="p-0 lg:flex-1 lg:min-h-0"
            >
              <div className="h-[360px] w-full lg:h-full">
                <TradingViewChart symbol={tvSymbol(activePairLabel)} />
              </div>
            </Card>
          )}

          {/* right column: markets selector + open position */}
          <div className="flex flex-col gap-3 lg:order-2 lg:col-span-3 lg:min-h-0">
          {/* markets */}
          <Card
            title={t("perps.marketsTitle")}
            right={
              markets.data?.totalOpenInterest !== undefined ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {t("perps.oi")}: {fmtUsd(markets.data.totalOpenInterest)}
                </span>
              ) : undefined
            }
          >
            {markets.isLoading ? (
              <p className="font-mono text-xs text-muted-foreground">…</p>
            ) : markets.error ? (
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-destructive">
                  {t("perps.loadError")}
                </span>
                <button
                  type="button"
                  onClick={() => void markets.refetch()}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {t("perps.retry")}
                </button>
              </div>
            ) : (markets.data?.pairs ?? []).length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">
                {t("perps.noMarkets")}
              </p>
            ) : (
              <div className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {t("perps.pair")}
                  </span>
                  <select
                    value={activePairLabel}
                    onChange={(e) => setPair(e.target.value)}
                    className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {(markets.data?.pairs ?? []).map((p) => (
                      <option key={p.index} value={p.pair}>
                        {p.pair}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  <Stat label={t("perps.price")} value={fmtPrice(livePrice)} />
                  <Stat
                    label={t("perps.maxLev")}
                    value={selectedPair?.maxLeverage ? `${selectedPair.maxLeverage}x` : "—"}
                  />
                  <Stat
                    label={t("perps.oiLong")}
                    value={fmtUsd(selectedPair?.openInterest?.long)}
                  />
                  <Stat
                    label={t("perps.oiShort")}
                    value={fmtUsd(selectedPair?.openInterest?.short)}
                  />
                  <Stat label={t("perps.spread")} value={fmtPct(selectedPair?.spreadP)} />
                </div>
              </div>
            )}
          </Card>

          {/* open position */}
          <Card
            title={t("perps.openTitle")}
            className="lg:flex lg:flex-1 lg:flex-col lg:min-h-0"
            bodyClassName="lg:flex-1 lg:min-h-0 lg:overflow-y-auto"
          >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {t("perps.pair")}
              </span>
              <div className="rounded border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground">
                {activePairLabel || "—"}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {t("perps.side")}
              </span>
              <div className="flex rounded border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSide("long")}
                  className={cn(
                    "flex-1 py-1.5 font-mono text-xs uppercase transition-colors",
                    side === "long"
                      ? "bg-green/15 text-green"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("perps.long")}
                </button>
                <button
                  type="button"
                  onClick={() => setSide("short")}
                  className={cn(
                    "flex-1 py-1.5 font-mono text-xs uppercase transition-colors border-l border-border",
                    side === "short"
                      ? "bg-destructive/15 text-destructive"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("perps.short")}
                </button>
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {t("perps.collateral")}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                placeholder="100"
                className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {t("perps.leverage")} ·{" "}
                {t("perps.leverageRange", { min: minLev, max: maxLev })}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={minLev}
                max={maxLev}
                value={leverage}
                onChange={(e) => setLeverage(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span>
              {t("perps.livePrice")}:{" "}
              <span className="text-foreground">{fmtPrice(livePrice)}</span>
            </span>
            <span>
              {t("perps.notional")}:{" "}
              <span className="text-foreground">{fmtUsd(notional)}</span>
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {t("perps.minNotice", { amount: minPos })}
          </p>

          <button
            type="button"
            disabled={!validOpen}
            onClick={handleReviewOpen}
            className={cn(
              "mt-3 w-full rounded px-3 py-2 font-mono text-xs uppercase transition-colors",
              validOpen
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {t("perps.reviewInChat")}
          </button>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {t("perps.reviewHint")}
          </p>
          </Card>
          </div>

          {/* positions */}
          <Card title={t("perps.positionsTitle")} className="lg:col-span-12 lg:order-4">
          {positions.isLoading ? (
            <p className="font-mono text-xs text-muted-foreground">…</p>
          ) : positions.data?.needsWallet ? (
            <p className="font-mono text-xs text-muted-foreground">
              {t("perps.needsWallet")}
            </p>
          ) : (positions.data?.positions ?? []).length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              {t("perps.noPositions")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {(positions.data?.positions ?? []).map((p, i) => (
                <div
                  key={`${p.pairIndex}-${p.index}-${i}`}
                  className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SideBadge side={p.side} t={t} />
                    <span className="font-mono text-xs text-foreground truncate">
                      {p.pair ?? "—"}
                    </span>
                    {p.leverage !== null && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {p.leverage.toFixed(p.leverage < 10 ? 1 : 0)}x
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-mono text-[11px] text-foreground">
                        {fmtUsd(p.collateralUsdc)}
                      </div>
                      {p.pnlUsdc !== null && (
                        <div
                          className={cn(
                            "font-mono text-[10px]",
                            p.pnlUsdc >= 0 ? "text-green" : "text-destructive",
                          )}
                        >
                          {p.pnlUsdc >= 0 ? "+" : ""}
                          {fmtUsd(p.pnlUsdc)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleClose(p)}
                      className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("perps.close")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

          {activePairLabel && (
            <PerpsTaPanel
              key={activePairLabel}
              pair={activePairLabel}
              lang={lang}
            />
          )}
        </div>
      </div>
    </div>
  );
}
