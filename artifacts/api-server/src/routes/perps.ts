import { Router, type IRouter } from "express";
import { callAvantisTool } from "../lib/avantis";
import { take } from "../lib/rate-limit";
import { getCurrentUserId, getCurrentUserWallet } from "../lib/user";
import { isProtocolEnabled } from "../lib/settings";
import {
  streamBunny,
  normalizeAgentLang,
  type AgentLang,
} from "../lib/bunny-agent";
import {
  fetchPythHistory,
  pythSymbolForFeedId,
  type Candle,
} from "../lib/pyth-history";
import { analyzeTimeframe, summarizeTimeframe } from "../lib/ta";

// Native read-only surface for the Avantis perps tab. Open/close are NOT
// exposed here — they flow through the chat agent (avantis_prepare_open /
// _prepare_close → Base MCP send_calls), reusing the existing, tested
// EIP-5792 approval path. This router only proxies the keyless read tools
// (markets, prices, a wallet's positions) into typed JSON for the UI.
const router: IRouter = Router();

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(o: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (v === "long" || v === "buy") return true;
    if (v === "short" || v === "sell") return false;
  }
  return null;
}

function firstNum(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = num(o[k]);
    if (n !== null) return n;
  }
  return null;
}

// Call a keyless Avantis read tool and parse its JSON envelope. Throws on the
// tool's own logical error so the route can answer 502 with the message.
async function readTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await callAvantisTool(name, args);
  if (res.isError) throw new Error(res.content);
  return JSON.parse(res.content) as T;
}

function guard(): { ok: true } | { ok: false; status: number; error: string } {
  if (!isProtocolEnabled("avantis")) {
    return { ok: false, status: 403, error: "avantis is disabled — enable it in configure" };
  }
  return { ok: true };
}

interface MarketPair {
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
}

// GET /api/perps/markets — all tradable pairs with leverage caps, OI, fees.
router.get("/perps/markets", async (req, res): Promise<void> => {
  const g = guard();
  if (!g.ok) {
    res.status(g.status).json({ error: g.error });
    return;
  }
  const rate = take(getCurrentUserId(), "security");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res.status(429).json({ error: "rate limited" });
    return;
  }
  try {
    const data = await readTool<{
      count: number;
      totalOpenInterest?: number;
      pairs: MarketPair[];
    }>("avantis_pairs", {});
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

// GET /api/perps/prices?pairs=ETH,BTC/USD — live Pyth oracle prices.
router.get("/perps/prices", async (req, res): Promise<void> => {
  const g = guard();
  if (!g.ok) {
    res.status(g.status).json({ error: g.error });
    return;
  }
  const raw = String(req.query["pairs"] ?? req.query["pair"] ?? "");
  const pairs = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (pairs.length === 0) {
    res.status(400).json({ error: "pairs query param is required" });
    return;
  }
  const rate = take(getCurrentUserId(), "security");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res.status(429).json({ error: "rate limited" });
    return;
  }
  try {
    const data = await readTool<{
      prices: Array<{
        pair?: string;
        index?: number;
        price?: number | null;
        confidence?: number | null;
        publishTime?: number;
        query?: string;
        error?: string;
      }>;
    }>("avantis_price", { pairs });
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

interface PositionView {
  pairIndex: number | null;
  index: number | null;
  pair: string | null;
  side: "long" | "short" | null;
  leverage: number | null;
  collateralUsdc: number | null;
  notionalUsdc: number | null;
  pnlUsdc: number | null;
  raw: Record<string, unknown>;
}

// Avantis core leverage is stored at 1e10 precision in some payloads and as a
// plain multiplier in others. Normalize defensively: huge values are scaled.
function normLeverage(v: number | null): number | null {
  if (v === null) return null;
  if (v > 1000) return v / 1e10;
  return v;
}

function projectPosition(
  raw: unknown,
  pairByIndex: Map<number, string>,
): PositionView | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pairIndex = firstNum(o, "pairIndex", "pair_index");
  const index = firstNum(o, "index", "tradeIndex", "trade_index");
  const collateralBase = firstNum(o, "collateral");
  const collateralUsdc = collateralBase !== null ? collateralBase / 1e6 : null;
  const leverage = normLeverage(firstNum(o, "leverage", "lev"));
  const side = bool(o, "long", "buy", "isLong", "side");
  const notionalUsdc =
    collateralUsdc !== null && leverage !== null
      ? collateralUsdc * leverage
      : null;
  // PnL only when the API already reports a human-scale USDC figure.
  const pnlRaw = firstNum(o, "pnl", "netPnl", "net_pnl", "profit");
  const pnlUsdc =
    pnlRaw !== null && Math.abs(pnlRaw) < 1e9 ? pnlRaw : null;
  return {
    pairIndex,
    index,
    pair: pairIndex !== null ? pairByIndex.get(pairIndex) ?? null : null,
    side: side === null ? null : side ? "long" : "short",
    leverage,
    collateralUsdc,
    notionalUsdc,
    pnlUsdc,
    raw: o,
  };
}

// GET /api/perps/positions — the active user's open positions + pending
// orders. Resolves pair labels via the markets payload. Returns
// needsWallet=true (200) when the user has no connected wallet yet.
router.get("/perps/positions", async (req, res): Promise<void> => {
  const g = guard();
  if (!g.ok) {
    res.status(g.status).json({ error: g.error });
    return;
  }
  const wallet = await getCurrentUserWallet();
  if (!wallet) {
    res.json({ needsWallet: true, positions: [], limitOrders: [] });
    return;
  }
  const rate = take(getCurrentUserId(), "security");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res.status(429).json({ error: "rate limited" });
    return;
  }
  try {
    const [pos, markets] = await Promise.all([
      readTool<{
        wallet: string;
        openPositions: number;
        pendingLimitOrders: number;
        positions: unknown[];
        limitOrders: unknown[];
      }>("avantis_positions", { wallet }),
      readTool<{ pairs: MarketPair[] }>("avantis_pairs", {}).catch(() => ({
        pairs: [] as MarketPair[],
      })),
    ]);
    const pairByIndex = new Map<number, string>(
      markets.pairs.map((p) => [p.index, p.pair]),
    );
    const positions = pos.positions
      .map((p) => projectPosition(p, pairByIndex))
      .filter((p): p is PositionView => p !== null);
    res.json({
      wallet,
      needsWallet: false,
      openPositions: pos.openPositions,
      pendingLimitOrders: pos.pendingLimitOrders,
      positions,
      limitOrders: pos.limitOrders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(4);
  return v.toPrecision(4);
}

interface TaContext {
  pair: string;
  symbol: string;
  livePrice: number | null;
  oiLong: number | null;
  oiShort: number | null;
  spreadP: number | null;
  maxLeverage: number | null;
}

function buildTaPrompt(
  ctx: TaContext,
  blocks: string[],
  lang: AgentLang,
): string {
  const oiLine = (() => {
    if (ctx.oiLong === null && ctx.oiShort === null) return "open interest: n/a";
    const l = ctx.oiLong ?? 0;
    const s = ctx.oiShort ?? 0;
    const tot = l + s;
    const longPct = tot > 0 ? ((l / tot) * 100).toFixed(1) : "n/a";
    const skew =
      tot <= 0
        ? "balanced"
        : l > s
          ? "long-skewed (crowded longs)"
          : s > l
            ? "short-skewed (crowded shorts)"
            : "balanced";
    return `open interest: long ${fmtNum(l)} / short ${fmtNum(s)} — ${longPct}% long, ${skew}`;
  })();

  const lines = [
    `write a professional but plain-spoken technical-analysis brief for this base perps pair on avantis. output github-flavored markdown. keep the prose lowercase (brand voice), tight, and skimmable.`,
    ``,
    `use exactly these five sections, in this order, each as a markdown heading with "## ":`,
    `## summary`,
    `## trend`,
    `## momentum`,
    `## levels`,
    `## verdict`,
    ``,
    `pair: ${ctx.pair} (pyth feed ${ctx.symbol})`,
    `live oracle price: ${fmtNum(ctx.livePrice)}`,
    `${oiLine}`,
    `spread: ${ctx.spreadP === null ? "n/a" : `${ctx.spreadP}%`} | max leverage: ${ctx.maxLeverage === null ? "n/a" : `${ctx.maxLeverage}x`}`,
    ``,
    `computed indicators per timeframe (price-action only — these candles come from the pyth oracle, whose reported volume is not reliable exchange volume; use the avantis open-interest skew above as the positioning signal instead of volume):`,
    ``,
    ...blocks,
    ``,
    `section guidance:`,
    `- ## summary: 1-2 sentences — the headline read on this pair right now (direction + conviction).`,
    `- ## trend: 3-4 bullets (use "- ") on trend across timeframes: price vs moving averages, alignment or conflict between the higher and lower timeframes.`,
    `- ## momentum: 3-4 bullets (use "- ") on rsi, macd histogram, bollinger position, and what the open-interest skew implies (crowded longs/shorts = squeeze risk).`,
    `- ## levels: list the key support and resistance from the recent ranges, and note atr (expected move / volatility). use "- " bullets.`,
    `- ## verdict: end with a bold line exactly like "**bias: long | short | neutral**" (pick one), followed by a one-clause reason and the timeframe it applies to.`,
    ``,
    `use **bold** for emphasis on key numbers or levels. do not give financial advice or guaranteed price predictions. do not propose or prepare any transaction. keep the whole brief under ~18 short lines.`,
  ];

  if (lang === "zh") {
    lines.push(
      ``,
      `重要（语言）：用简体中文撰写整篇简报。五个小标题写作 "## 概要"、"## 趋势"、"## 动能"、"## 关键价位"、"## 结论"。忽略上面关于全部小写的要求。交易对、数字、指标名称（rsi/macd 等）保留原文。结论以加粗行结尾，写作 "**方向：做多 | 做空 | 中性**"（三选一），其后跟一句简短理由及适用周期。`,
    );
  } else if (lang === "ko") {
    lines.push(
      ``,
      `중요(언어): 전체 브리프를 한국어로 작성하세요. 다섯 개의 제목은 "## 요약"、"## 추세"、"## 모멘텀"、"## 주요 가격대"、"## 결론"으로 작성합니다. 위의 소문자 규칙은 무시하세요. 페어, 숫자, 지표 이름(rsi/macd 등)은 원문 그대로 두세요. 결론은 "**방향: 롱 | 숏 | 중립**" 형식의 굵은 줄로 끝내고 한 구절의 이유와 적용 시간대를 덧붙이세요.`,
    );
  } else {
    lines.push(
      ``,
      `important (language): write the entire brief in English. keep the pair, numbers, and indicator names (rsi/macd/etc.) in their original form.`,
    );
  }
  return lines.join("\n");
}

// POST /api/perps/ta/stream — fresh, streamed technical-analysis report for one
// pair. Candles come from Pyth's free benchmarks shim; indicators are computed
// deterministically in ta.ts and narrated by the agent. Same SSE shape and
// "chat" rate limit as the token report; no persistence — each click regenerates.
router.post("/perps/ta/stream", async (req, res): Promise<void> => {
  const g = guard();
  if (!g.ok) {
    res.status(g.status).json({ error: g.error });
    return;
  }
  const body = (req.body ?? {}) as { pair?: unknown; lang?: unknown };
  const pair = typeof body.pair === "string" ? body.pair.trim() : "";
  if (!pair) {
    res.status(400).json({ error: "pair is required" });
    return;
  }

  const rate = take(getCurrentUserId(), "chat");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res
      .status(429)
      .json({ error: "rate limit exceeded", retryAfterSec: rate.retryAfterSec });
    return;
  }

  // Resolve the pair -> Avantis market (feedId, OI, spread, leverage) and the
  // pyth symbol BEFORE opening the SSE stream so a bad pair returns a clean 400.
  let market: MarketPair | undefined;
  let symbol: string | null = null;
  try {
    const markets = await readTool<{ pairs: MarketPair[] }>("avantis_pairs", {});
    market = markets.pairs.find(
      (p) => p.pair.toLowerCase() === pair.toLowerCase(),
    );
    if (!market) {
      res.status(400).json({ error: `unknown pair: ${pair}` });
      return;
    }
    symbol = await pythSymbolForFeedId(market.feedId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
    return;
  }
  if (!symbol) {
    res
      .status(400)
      .json({ error: `no pyth history feed for ${pair}` });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": connected\n\n");
  const flush = (res as unknown as { flush?: () => void }).flush;
  if (typeof flush === "function") flush.call(res);

  const write = (event: unknown): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (typeof flush === "function") flush.call(res);
  };

  let closed = false;
  const keepAlive = setInterval(() => {
    if (closed) return;
    res.write(": ping\n\n");
    if (typeof flush === "function") flush.call(res);
  }, 15000);
  res.on("close", () => {
    closed = true;
    clearInterval(keepAlive);
  });

  const lang = normalizeAgentLang(body.lang);
  const nowSec = Math.floor(Date.now() / 1000);
  const DAY = 86400;
  const windows: Array<{ label: string; res: string; from: number }> = [
    { label: "1h", res: "60", from: nowSec - 21 * DAY },
    { label: "4h", res: "240", from: nowSec - 90 * DAY },
    { label: "1d", res: "D", from: nowSec - 365 * DAY },
  ];

  try {
    const results = await Promise.all(
      windows.map(async (w) => {
        try {
          const candles: Candle[] = await fetchPythHistory(
            symbol as string,
            w.res,
            w.from,
            nowSec,
          );
          return analyzeTimeframe(w.label, candles);
        } catch (err) {
          req.log.warn({ err, tf: w.label }, "pyth history fetch failed");
          return null;
        }
      }),
    );
    const blocks = results
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map(summarizeTimeframe);

    if (blocks.length === 0) {
      write({ type: "error", message: "no candle data available for this pair" });
      return;
    }

    const ctx: TaContext = {
      pair: market.pair,
      symbol,
      livePrice: results.find((r) => r)?.close ?? null,
      oiLong: market.openInterest?.long ?? null,
      oiShort: market.openInterest?.short ?? null,
      spreadP: market.spreadP ?? null,
      maxLeverage: market.maxLeverage ?? null,
    };
    const prompt = buildTaPrompt(ctx, blocks, lang);

    for await (const ev of streamBunny(prompt, undefined, lang)) {
      if (closed) break;
      write(ev);
    }
  } catch (err) {
    req.log.error({ err }, "perps ta stream failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    write({ type: "error", message });
  } finally {
    clearInterval(keepAlive);
    if (!closed) {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
  }
});

export default router;
