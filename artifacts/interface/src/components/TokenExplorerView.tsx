import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Share2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTabs } from "./TabsContext";
import { useAppStore } from "@/lib/store";
import { fmtUsd, fmtPct, fmtNum, ageDays, fmtAge } from "./report/format";
import {
  deriveSecurityItems,
  type Tone,
  type TokenSecurity,
} from "./report/security";
import { Markdown } from "./report/Markdown";
import type { ChartPoint, ReportData } from "./report/types";
import { useT, useLang } from "@/i18n";

type TrendingToken = {
  tokenAddress: string;
  symbol: string;
  name: string;
  logo: string | null;
  usdPrice: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  createdAt: number | null;
  pricePercentChange1h: number | null;
  pricePercentChange24h: number | null;
  totalVolume24h: number | null;
};

type StreamEvent =
  | { type: "model"; model: string }
  | { type: "thinking" }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean }
  | { type: "content"; delta: string }
  | { type: "done"; model: string; response: string }
  | { type: "error"; message: string };

type SortKey =
  | "marketCap"
  | "liquidityUsd"
  | "totalVolume24h"
  | "pricePercentChange1h"
  | "pricePercentChange24h"
  | "holders"
  | "createdAt";

type SortDir = "asc" | "desc";

type Filters = {
  minLiquidity: string;
  minVolume24h: string;
  minMarketCap: string;
  minHolders: string;
  maxAgeDays: string;
  min1hChange: string;
  min24hChange: string;
};

const EMPTY_FILTERS: Filters = {
  minLiquidity: "",
  minVolume24h: "",
  minMarketCap: "",
  minHolders: "",
  maxAgeDays: "",
  min1hChange: "",
  min24hChange: "",
};

function changeColor(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "text-muted-foreground";
  if (v > 0) return "text-green";
  if (v < 0) return "text-destructive";
  return "text-muted-foreground";
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function FilterField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 font-mono text-xs"
      />
    </label>
  );
}

// Token icon with a blue default avatar (the symbol's first letter) for tokens
// that have no logo — also the fallback when a logo URL fails to load.
function TokenAvatar({
  logo,
  symbol,
  size,
}: {
  logo: string | null;
  symbol: string;
  size: "sm" | "md";
}) {
  const [broken, setBroken] = useState(false);
  const dim = size === "md" ? "h-6 w-6" : "h-5 w-5";
  const txt = size === "md" ? "text-[11px]" : "text-[9px]";
  if (logo && !broken) {
    return (
      <img
        src={logo}
        alt=""
        className={cn(dim, "rounded-full shrink-0 object-cover")}
        onError={() => setBroken(true)}
      />
    );
  }
  const letter = (symbol || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={cn(
        dim,
        txt,
        "rounded-full shrink-0 flex items-center justify-center bg-blue-500 font-mono font-semibold text-white",
      )}
      aria-hidden="true"
    >
      {letter}
    </div>
  );
}

const COLUMNS: Array<{ key: SortKey; labelKey: string }> = [
  { key: "marketCap", labelKey: "colMktCap" },
  { key: "liquidityUsd", labelKey: "colLiquidity" },
  { key: "totalVolume24h", labelKey: "col24hVol" },
  { key: "pricePercentChange1h", labelKey: "col1h" },
  { key: "pricePercentChange24h", labelKey: "col24h" },
  { key: "holders", labelKey: "colHolders" },
  { key: "createdAt", labelKey: "colAge" },
];

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-border text-muted-foreground",
  warn: "border-border text-muted-foreground",
  bad: "border-border text-destructive",
  muted: "border-border text-muted-foreground",
};

function SecurityBadges({ s }: { s: TokenSecurity }) {
  const t = useT();
  const items = deriveSecurityItems(s);

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("tokens.contractSecurity")}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {t("tokens.viaGoplus")}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it.label}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
              TONE_CLASS[it.tone],
            )}
          >
            <span className="opacity-70">{it.label}</span>
            <span className="font-medium">{it.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TokenReportPanel({
  token,
  onClose,
  onBuy,
}: {
  token: TrendingToken;
  onClose?: () => void;
  onBuy: (token: TrendingToken) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"streaming" | "done" | "error">(
    "streaming",
  );
  const [errorMsg, setErrorMsg] = useState("");
  // Captured once when the report completes, then reused for both the on-screen
  // header and the PDF so they always show the same "generated" time.
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: security } = useQuery({
    queryKey: ["/api/tokens/security", token.tokenAddress],
    queryFn: async (): Promise<TokenSecurity | null> => {
      const r = await fetch(
        `/api/tokens/security?address=${token.tokenAddress}`,
      );
      // Throw on failure so it surfaces as a query error (and gets retried)
      // instead of being cached as a permanent "no data" success.
      if (!r.ok) throw new Error(`security ${r.status}`);
      const j = (await r.json()) as { security?: TokenSecurity | null };
      return j.security ?? null;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Daily price/volume candles for the static chart embedded in the PDF. The
  // on-screen chart is a GeckoTerminal iframe (can't go in a PDF), so the PDF
  // draws its own SVG chart from this CoinGecko data. Best-effort: an empty
  // array just omits the chart from the report.
  const { data: chart } = useQuery({
    queryKey: ["/api/tokens/chart", token.tokenAddress],
    queryFn: async (): Promise<ChartPoint[]> => {
      const r = await fetch(`/api/tokens/chart?address=${token.tokenAddress}`);
      if (!r.ok) return [];
      const j = (await r.json()) as { chart?: ChartPoint[] };
      return j.chart ?? [];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    setText("");
    setStatus("streaming");
    setErrorMsg("");
    setGeneratedAt(null);

    // Only an explicit `done` event marks the report complete (which gates the
    // PDF/share actions). A stream that ends without it — network drop, proxy
    // timeout, upstream abort — must NOT be treated as a finished report.
    let sawDone = false;
    let sawError = false;

    const processChunk = (chunk: string) => {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) return;
      const data = dataLine.slice(5).trim();
      if (!data) return;
      let ev: StreamEvent;
      try {
        ev = JSON.parse(data) as StreamEvent;
      } catch {
        return;
      }
      if (ev.type === "content") {
        setText((t) => t + ev.delta);
      } else if (ev.type === "done") {
        if (ev.response) setText(ev.response);
        sawDone = true;
        setGeneratedAt(new Date());
        setStatus("done");
      } else if (ev.type === "error") {
        sawError = true;
        setErrorMsg(ev.message);
        setStatus("error");
      }
    };

    (async () => {
      try {
        const resp = await fetch("/api/tokens/report/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenAddress: token.tokenAddress,
            symbol: token.symbol,
            name: token.name,
            usdPrice: token.usdPrice,
            marketCap: token.marketCap,
            liquidityUsd: token.liquidityUsd,
            holders: token.holders,
            createdAt: token.createdAt,
            pricePercentChange1h: token.pricePercentChange1h,
            pricePercentChange24h: token.pricePercentChange24h,
            totalVolume24h: token.totalVolume24h,
            lang,
          }),
          signal: abort.signal,
        });
        if (resp.status === 429) {
          setErrorMsg(t("tokens.rateLimitReached"));
          setStatus("error");
          return;
        }
        if (!resp.ok || !resp.body) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buf += decoder.decode();
            if (buf.trim()) processChunk(buf);
            break;
          }
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const c = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            processChunk(c);
          }
        }
        if (sawDone) {
          setStatus("done");
        } else if (!sawError) {
          // Stream ended without a terminal `done` event — the report is
          // truncated. Surface it as an error so PDF/share stay disabled.
          setErrorMsg(t("tokens.reportEndedEarly"));
          setStatus("error");
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => abort.abort();
  }, [token, lang]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const [pdfBusy, setPdfBusy] = useState<"idle" | "download" | "share">("idle");
  const [pdfError, setPdfError] = useState("");
  const ready = status === "done" && text.trim() !== "";

  const buildReportData = (): ReportData => ({
    token,
    security: security ?? null,
    analysis: text,
    chart: chart ?? [],
    generatedAt: generatedAt ?? new Date(),
  });

  const handleDownload = async () => {
    if (!ready || pdfBusy !== "idle") return;
    setPdfBusy("download");
    setPdfError("");
    try {
      const { downloadReportPdf } = await import("./report/ReportPdf");
      await downloadReportPdf(buildReportData());
    } catch {
      setPdfError(t("tokens.pdfGenerateError"));
    } finally {
      setPdfBusy("idle");
    }
  };

  const handleShare = async () => {
    if (!ready || pdfBusy !== "idle") return;
    setPdfBusy("share");
    setPdfError("");
    try {
      const { shareReportPdf, downloadReportPdf } = await import("./report/ReportPdf");
      const data = buildReportData();
      const shared = await shareReportPdf(data);
      if (!shared) await downloadReportPdf(data);
    } catch {
      setPdfError(t("tokens.pdfShareError"));
    } finally {
      setPdfBusy("idle");
    }
  };

  const stats: { id: string; label: string; value: string; tone?: "up" | "down" }[] = [
    { id: "price", label: t("tokens.colPrice"), value: fmtUsd(token.usdPrice) },
    { id: "mktCap", label: t("tokens.colMktCap"), value: fmtUsd(token.marketCap, true) },
    { id: "liquidity", label: t("tokens.colLiquidity"), value: fmtUsd(token.liquidityUsd, true) },
    { id: "vol24h", label: t("tokens.stat24hOnchainVol"), value: fmtUsd(token.totalVolume24h, true) },
    { id: "holders", label: t("tokens.colHolders"), value: fmtNum(token.holders) },
    { id: "age", label: t("tokens.colAge"), value: fmtAge(token.createdAt) },
    {
      id: "change1h",
      label: t("tokens.col1h"),
      value: fmtPct(token.pricePercentChange1h),
      tone:
        token.pricePercentChange1h == null
          ? undefined
          : token.pricePercentChange1h >= 0
            ? "up"
            : "down",
    },
    {
      id: "change24h",
      label: t("tokens.col24h"),
      value: fmtPct(token.pricePercentChange24h),
      tone:
        token.pricePercentChange24h == null
          ? undefined
          : token.pricePercentChange24h >= 0
            ? "up"
            : "down",
    },
  ];

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex items-start justify-between gap-2 border-b border-border/50 px-4 py-3 shrink-0">
        <div className="flex items-start gap-2 min-w-0">
          <TokenAvatar logo={token.logo} symbol={token.symbol} size="md" />
          <div className="min-w-0">
            <div className="font-sans text-sm font-medium truncate">
              {token.symbol || "?"}
              {token.name ? (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {token.name}
                </span>
              ) : null}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {token.tokenAddress}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {generatedAt
                ? t("tokens.generatedAt", {
                    time: generatedAt.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })
                : t("tokens.generating")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!ready || pdfBusy !== "idle"}
            title={t("tokens.downloadPdf")}
            aria-label={t("tokens.downloadPdf")}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {pdfBusy === "download" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {t("tokens.downloadPdf")}
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={!ready || pdfBusy !== "idle"}
            title={t("tokens.share")}
            aria-label={t("tokens.shareReport")}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {pdfBusy === "share" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Share2 className="h-3 w-3" />
            )}
            {t("tokens.share")}
          </button>
          <button
            type="button"
            onClick={() => onBuy(token)}
            className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline px-1"
          >
            {t("tokens.buy")}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("tokens.closeReport")}
              className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 overflow-hidden border-b border-border/50">
          <iframe
            key={token.tokenAddress}
            src={`https://www.geckoterminal.com/base/tokens/${token.tokenAddress}?embed=1&info=0&swaps=0&light_chart=1`}
            title={t("tokens.chartTitle", {
              symbol: token.symbol || token.tokenAddress,
            })}
            loading="lazy"
            className="h-[390px] w-full border-0 bg-background"
          />
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4 grid grid-cols-4 gap-x-3 gap-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </div>
                <div
                  className={cn(
                    "font-mono text-xs font-medium truncate",
                    s.tone === "up" && "text-green",
                    s.tone === "down" && "text-destructive",
                    !s.tone && "text-foreground",
                  )}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {security && <SecurityBadges s={security} />}

          {pdfError && (
            <div className="mb-2 font-mono text-[10px] text-destructive">
              {pdfError}
            </div>
          )}

          {status === "error" ? (
            <div className="font-mono text-xs text-destructive">
              {t("tokens.errorPrefix")}: {errorMsg || t("tokens.failedToGenerateReport")}
            </div>
          ) : text ? (
            <Markdown source={text} />
          ) : (
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t("tokens.generatingReport")}</span>
            </div>
          )}
          {status === "streaming" && text && (
            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t("tokens.writing")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Right-side panel placeholder while a shared (deep-linked) report is being
// resolved, or when its token can't be hydrated. Keeps the same border/bg as
// TokenReportPanel so the layout doesn't jump.
function ReportPanelPlaceholder({
  state,
  address,
}: {
  state: "loading" | "missing";
  address?: string | null;
}) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 border-l border-border bg-background px-6 text-center">
      {state === "loading" ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {t("tokens.loadingSharedReport")}
          </div>
        </>
      ) : (
        <>
          <div className="font-mono text-xs text-destructive">
            {t("tokens.couldntLoadReport")}
          </div>
          {address && (
            <div className="font-mono text-[10px] text-muted-foreground break-all">
              {address}
            </div>
          )}
          <div className="font-mono text-[10px] text-muted-foreground">
            {t("tokens.notBaseTokenOrUnavailable")}
          </div>
        </>
      )}
    </div>
  );
}

type Source = "moralis" | "virtuals" | "bankr";

// Per-source data provenance shown in the header info tooltip so users know
// exactly where each list comes from and how it's filtered/enriched.
const METHODOLOGY: Record<
  Source,
  { title: string; source: string; filters: string; market: string }
> = {
  moralis: {
    title: "methodologyMoralisTitle",
    source: "methodologyMoralisSource",
    filters: "methodologyMoralisFilters",
    market: "methodologyMoralisMarket",
  },
  virtuals: {
    title: "methodologyVirtualsTitle",
    source: "methodologyVirtualsSource",
    filters: "methodologyVirtualsFilters",
    market: "methodologyVirtualsMarket",
  },
  bankr: {
    title: "methodologyBankrTitle",
    source: "methodologyBankrSource",
    filters: "methodologyBankrFilters",
    market: "methodologyBankrMarket",
  },
};

export function TokenExplorerView() {
  const t = useT();
  const [source, setSource] = useState<Source>("moralis");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("totalVolume24h");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<TrendingToken | null>(null);
  const { tabs, setActive } = useTabs();
  const setChatInput = useAppStore((s) => s.setChatInput);

  // Deep link: /terminal/report/<address> opens this view focused on a given
  // token. The shared token may not be in the trending list, so fetch its
  // metadata by address to hydrate the report panel.
  const [, reportParams] = useRoute("/terminal/report/:address");
  const routeAddress = reportParams?.address ?? null;

  const { data: sharedToken, status: sharedStatus } = useQuery({
    queryKey: ["/api/tokens/by-address", routeAddress?.toLowerCase()],
    enabled: !!routeAddress,
    queryFn: async (): Promise<TrendingToken | null> => {
      const r = await fetch(`/api/tokens/by-address?address=${routeAddress}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { token?: TrendingToken | null };
      return j.token ?? null;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const buyToken = (token: TrendingToken) => {
    setChatInput(t("tokens.buyCommand", { address: token.tokenAddress }));
    // Reveal a view that contains the chat input: on mobile chat is its own
    // tab, on desktop it lives inside the home 3-column layout.
    setActive(tabs.some((t) => t.id === "chat") ? "chat" : "home");
    queueMicrotask(() => {
      document.getElementById("chat-input")?.focus();
    });
  };

  const forceRef = useRef(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["/api/tokens", source],
    queryFn: async (): Promise<TrendingToken[]> => {
      const fresh = forceRef.current;
      forceRef.current = false;
      const r = await fetch(
        `/api/tokens?limit=100&source=${source}${fresh ? "&fresh=1" : ""}`,
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { tokens?: TrendingToken[] };
      return Array.isArray(j.tokens) ? j.tokens : [];
    },
    // No auto-refresh: only fetch on first load, on source switch, or when the
    // user clicks refresh — avoids hammering rate limits in the background.
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: Infinity,
  });

  const handleRefresh = () => {
    forceRef.current = true;
    void refetch();
  };

  const setFilter = (k: keyof Filters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    const all = data ?? [];
    const minLiq = parseNum(filters.minLiquidity);
    const minVol = parseNum(filters.minVolume24h);
    const minMc = parseNum(filters.minMarketCap);
    const minHolders = parseNum(filters.minHolders);
    const maxAge = parseNum(filters.maxAgeDays);
    const min1h = parseNum(filters.min1hChange);
    const min24h = parseNum(filters.min24hChange);

    const filtered = all.filter((t) => {
      if (minLiq !== null && (t.liquidityUsd ?? -Infinity) < minLiq) return false;
      if (minVol !== null && (t.totalVolume24h ?? -Infinity) < minVol) return false;
      if (minMc !== null && (t.marketCap ?? -Infinity) < minMc) return false;
      if (minHolders !== null && (t.holders ?? -Infinity) < minHolders) return false;
      if (min1h !== null && (t.pricePercentChange1h ?? -Infinity) < min1h) return false;
      if (min24h !== null && (t.pricePercentChange24h ?? -Infinity) < min24h) return false;
      if (maxAge !== null) {
        const d = ageDays(t.createdAt);
        if (d === null || d > maxAge) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = av === null || !Number.isFinite(av) ? -Infinity : av;
      const bn = bv === null || !Number.isFinite(bv) ? -Infinity : bv;
      if (an === bn) return 0;
      return an < bn ? -1 * dir : 1 * dir;
    });
    return filtered;
  }, [data, filters, sortKey, sortDir]);

  const anyFilter = Object.values(filters).some((v) => v.trim() !== "");

  // Resolve the deep-linked token: prefer a matching row (full metrics) and
  // fall back to the by-address fetch. Auto-select it once per address so the
  // report panel (desktop) and overlay (mobile) open straight to it.
  const routeToken: TrendingToken | null = routeAddress
    ? (rows.find(
        (t) => t.tokenAddress.toLowerCase() === routeAddress.toLowerCase(),
      ) ??
      sharedToken ??
      null)
    : null;

  const routeSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      routeAddress &&
      routeToken &&
      routeSelectedRef.current !== routeAddress.toLowerCase()
    ) {
      routeSelectedRef.current = routeAddress.toLowerCase();
      setSelected(routeToken);
    }
  }, [routeAddress, routeToken]);

  // In deep-link mode the panel is driven *only* by the resolved route token
  // (or a later user selection) — never the list's first row — so we don't
  // start streaming a report for the wrong token while /api/tokens/by-address
  // is still resolving.
  const isDeepLink = !!routeAddress;
  const reportToken = isDeepLink
    ? (selected ?? routeToken)
    : (selected ?? (rows.length > 0 ? rows[0] : null));
  const deepLinkResolving = isDeepLink && !reportToken && sharedStatus === "pending";
  const deepLinkMissing = isDeepLink && !reportToken && sharedStatus !== "pending";

  return (
    <div className="flex h-full w-full min-h-0">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="font-sans text-sm font-medium">{t("tokens.researchBase")}</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("tokens.dataMethodology")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="max-w-xs bg-popover text-popover-foreground border border-border shadow-md"
                >
                  <div className="space-y-1.5 py-0.5 font-sans text-[11px] leading-snug">
                    <p className="font-medium">{t(`tokens.${METHODOLOGY[source].title}`)}</p>
                    <p>
                      <span className="text-muted-foreground">{t("tokens.sourceLabel")} </span>
                      {t(`tokens.${METHODOLOGY[source].source}`)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("tokens.filtersLabel")} </span>
                      {t(`tokens.${METHODOLOGY[source].filters}`)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("tokens.marketDataLabel")} </span>
                      {t(`tokens.${METHODOLOGY[source].market}`)}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              {source === "bankr"
                ? t("tokens.subtitleBankr")
                : source === "virtuals"
                  ? t("tokens.subtitleVirtuals")
                  : t("tokens.subtitleMoralis")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center rounded border border-border p-0.5">
              {(["moralis", "virtuals", "bankr"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={cn(
                    "rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    source === s
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="h-7 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("h-3 w-3 mr-1", isFetching && "animate-spin")} />
              {t("tokens.refresh")}
            </Button>
          </div>
        </div>

        <div className="border-b border-border/50 px-4 py-3 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <FilterField
              label={t("tokens.filterMinLiq")}
              value={filters.minLiquidity}
              onChange={(v) => setFilter("minLiquidity", v)}
              placeholder="0"
            />
            <FilterField
              label={t("tokens.filterMin24hVol")}
              value={filters.minVolume24h}
              onChange={(v) => setFilter("minVolume24h", v)}
              placeholder="0"
            />
            <FilterField
              label={t("tokens.filterMinMktCap")}
              value={filters.minMarketCap}
              onChange={(v) => setFilter("minMarketCap", v)}
              placeholder="0"
            />
            <FilterField
              label={t("tokens.filterMinHolders")}
              value={filters.minHolders}
              onChange={(v) => setFilter("minHolders", v)}
              placeholder="0"
            />
            <FilterField
              label={t("tokens.filterMaxAge")}
              value={filters.maxAgeDays}
              onChange={(v) => setFilter("maxAgeDays", v)}
              placeholder="∞"
            />
            <FilterField
              label={t("tokens.filterMin1h")}
              value={filters.min1hChange}
              onChange={(v) => setFilter("min1hChange", v)}
              placeholder="-100"
            />
            <FilterField
              label={t("tokens.filterMin24h")}
              value={filters.min24hChange}
              onChange={(v) => setFilter("min24hChange", v)}
              placeholder="-100"
            />
          </div>
          {anyFilter && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {t("tokens.clearFilters")}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {source === "bankr"
                  ? t("tokens.loadingRecentLaunches")
                  : source === "virtuals"
                    ? t("tokens.loadingVirtualsTokens")
                    : t("tokens.loadingTrendingTokens")}
              </span>
            </div>
          ) : isError ? (
            <div className="px-4 py-16 text-center">
              <p className="font-mono text-xs text-destructive">
                {error instanceof Error ? error.message : t("tokens.failedToLoadTokens")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                className="mt-3 font-mono text-[11px]"
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-16 text-center font-mono text-xs text-muted-foreground">
              {anyFilter
                ? t("tokens.noTokensMatchFilters")
                : source === "bankr"
                  ? t("tokens.noRecentLaunches")
                  : source === "virtuals"
                    ? t("tokens.noVirtualsTokens")
                    : t("tokens.noTrendingTokens")}
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("tokens.colToken")}
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("tokens.colPrice")}
                  </th>
                  {COLUMNS.map((c) => {
                    const active = c.key === sortKey;
                    return (
                      <th
                        key={c.key}
                        className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground",
                            active ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {t(`tokens.${c.labelKey}`)}
                          {active &&
                            (sortDir === "desc" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            ))}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.tokenAddress}
                    onClick={() => setSelected(t)}
                    className={cn(
                      "cursor-pointer border-b border-border/40 hover:bg-foreground/5",
                      selected?.tokenAddress === t.tokenAddress && "bg-foreground/5",
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TokenAvatar logo={t.logo} symbol={t.symbol} size="sm" />
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-foreground truncate max-w-[140px]">
                            {t.symbol || "?"}
                          </div>
                          <div className="font-sans text-[10px] text-muted-foreground truncate max-w-[140px]">
                            {t.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {fmtUsd(t.usdPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {fmtUsd(t.marketCap, true)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {fmtUsd(t.liquidityUsd, true)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {fmtUsd(t.totalVolume24h, true)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono text-xs",
                        changeColor(t.pricePercentChange1h),
                      )}
                    >
                      {fmtPct(t.pricePercentChange1h)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono text-xs",
                        changeColor(t.pricePercentChange24h),
                      )}
                    >
                      {fmtPct(t.pricePercentChange24h)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                      {fmtNum(t.holders)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                      {fmtAge(t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {(reportToken || deepLinkResolving || deepLinkMissing) && (
        <div className="w-[35%] min-w-[360px] shrink-0 hidden md:block">
          {reportToken ? (
            <TokenReportPanel token={reportToken} onBuy={buyToken} />
          ) : (
            <ReportPanelPlaceholder
              state={deepLinkResolving ? "loading" : "missing"}
              address={routeAddress}
            />
          )}
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSelected(null)}
          />
          <div className="absolute inset-y-0 right-0 w-[90%] max-w-sm">
            <TokenReportPanel
              token={selected}
              onClose={() => setSelected(null)}
              onBuy={buyToken}
            />
          </div>
        </div>
      )}
    </div>
  );
}
