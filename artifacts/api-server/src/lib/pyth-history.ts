import { logger } from "./logger";

// Historical OHLC for Avantis perps pairs, sourced from Pyth's free, keyless
// public services — the same oracle network the protocol trades against, so the
// candles match the price the user actually opens/closes at:
//   - hermes /v2/price_feeds → feedId -> Pyth symbol metadata (e.g.
//     "Crypto.ETH/USD"), cached in-process.
//   - benchmarks TradingView history shim → OHLC candles by Pyth symbol.
// Pyth is an oracle, not an exchange, so candles carry NO real volume — the
// report leans on price action + Avantis open-interest skew instead.

const HERMES_FEEDS = "https://hermes.pyth.network/v2/price_feeds";
const BENCH_HISTORY =
  "https://benchmarks.pyth.network/v1/shims/tradingview/history";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface FeedMeta {
  id?: string;
  attributes?: { symbol?: string };
}

let symbolCache: Map<string, string> | null = null;
let symbolCacheAt = 0;
const SYMBOL_TTL_MS = 6 * 60 * 60 * 1000;

function normFeedId(id: string): string {
  return id.toLowerCase().replace(/^0x/, "");
}

async function loadSymbolMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (symbolCache && now - symbolCacheAt < SYMBOL_TTL_MS) return symbolCache;
  const resp = await fetch(HERMES_FEEDS, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`pyth price_feeds ${resp.status}`);
  }
  const feeds = (await resp.json()) as FeedMeta[];
  const map = new Map<string, string>();
  for (const f of feeds) {
    const id = typeof f.id === "string" ? f.id : "";
    const sym = f.attributes?.symbol;
    if (id && sym) map.set(normFeedId(id), sym);
  }
  symbolCache = map;
  symbolCacheAt = now;
  return map;
}

// Resolve an Avantis pair's Pyth feedId to its TradingView-shim symbol
// ("Crypto.ETH/USD", "FX.EUR/USD", "Metal.XAU/USD", …). Returns null when the
// feed isn't published in Pyth's metadata.
export async function pythSymbolForFeedId(
  feedId: string | undefined | null,
): Promise<string | null> {
  if (!feedId) return null;
  try {
    const map = await loadSymbolMap();
    return map.get(normFeedId(feedId)) ?? null;
  } catch (err) {
    logger.warn({ err }, "pyth symbol map load failed");
    return null;
  }
}

interface UdfHistory {
  s: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
}

// Fetch OHLC candles for a Pyth symbol over [from, to] (unix seconds) at the
// given TradingView resolution ("60", "240", "D", …). Returns [] on no_data.
export async function fetchPythHistory(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
): Promise<Candle[]> {
  const url = new URL(BENCH_HISTORY);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("resolution", resolution);
  url.searchParams.set("from", String(Math.floor(from)));
  url.searchParams.set("to", String(Math.floor(to)));
  const resp = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    throw new Error(`pyth history ${resp.status}`);
  }
  const data = (await resp.json()) as UdfHistory;
  if (data.s !== "ok" || !data.t || !data.c) return [];
  const out: Candle[] = [];
  for (let i = 0; i < data.t.length; i++) {
    const t = data.t[i];
    const o = data.o?.[i];
    const h = data.h?.[i];
    const l = data.l?.[i];
    const c = data.c?.[i];
    if (
      Number.isFinite(t) &&
      Number.isFinite(o) &&
      Number.isFinite(h) &&
      Number.isFinite(l) &&
      Number.isFinite(c)
    ) {
      out.push({
        t: t as number,
        o: o as number,
        h: h as number,
        l: l as number,
        c: c as number,
      });
    }
  }
  return out;
}
