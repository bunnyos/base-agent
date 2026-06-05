import { logger } from "./logger";
import { getCurrentUserWallet } from "./user";

// Avantis perps (leverage trading) on Base. Read tools use only public,
// keyless endpoints — no contract reads, no API key:
//   - socket-api  → live market data: listed pairs, open interest, borrow
//                   fees, leverage caps, spread, liquidity (one fat JSON blob)
//   - Pyth Hermes → live oracle prices, keyed by each pair's Pyth feedId
//                   (the feedId is published in the socket-api payload)
//   - core API    → a trader's open positions + pending limit orders / PnL
//
// Write tools (Phase 2: enter/exit positions) DO NOT sign or broadcast. They
// ask Avantis's official tx-builder service for ready-to-sign calldata and
// return it in a `transactions` array. bunny-agent.ts forwards that array to
// Base MCP's `send_calls` (EIP-5792) — Bunny never holds a private key and
// never broadcasts. Every on-chain tx flows through Base MCP.
const SOCKET_API = "https://socket-api-pub.avantisfi.com/socket-api/v1/data";
const CORE_API_BASE = "https://core.avantisfi.com";
const HERMES_BASE = "https://hermes.pyth.network/v2/updates/price/latest";
const TX_BUILDER = "https://tx-builder.avantisfi.com";

export interface AvantisTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type Json = Record<string, unknown>;

interface PairInfo {
  index: number;
  from: string;
  to: string;
  feed?: { feedId?: string };
  openInterest?: { long?: number; short?: number };
  marginFee?: { long?: number; short?: number };
  leverages?: {
    minLeverage?: number;
    maxLeverage?: number;
    pnlMinLeverage?: number;
    pnlMaxLeverage?: number;
  };
  groupIndex?: number;
  spreadP?: number;
  openFeeP?: number;
  closeFeeP?: number;
  pairOI?: number;
  pairMaxOI?: number;
  minLevPosUSDC?: number;
  liquidity?: { buy?: number; sell?: number };
  isPairListed?: boolean;
  [k: string]: unknown;
}

interface SocketData {
  totalOi?: number;
  pairCount?: number;
  groupInfo?: Record<string, Json>;
  pairInfos: Record<string, PairInfo>;
  [k: string]: unknown;
}

// ---------- socket-api cache ----------
// The socket payload is large and global (same for every user), so cache it
// process-wide for a short window to avoid refetching on every tool call.
let socketCache: { at: number; data: SocketData } | null = null;
const SOCKET_TTL_MS = 15_000;

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`${resp.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function getSocketData(): Promise<SocketData> {
  const now = Date.now();
  if (socketCache && now - socketCache.at < SOCKET_TTL_MS) {
    return socketCache.data;
  }
  const raw = (await fetchJson(SOCKET_API)) as { data?: SocketData };
  const data = raw?.data;
  if (!data || typeof data !== "object" || !data.pairInfos) {
    throw new Error("Avantis socket-api returned an unexpected shape");
  }
  socketCache = { at: now, data };
  return data;
}

// ---------- pair resolution ----------

function pairLabel(p: PairInfo): string {
  return `${p.from}/${p.to}`;
}

// Accepts "ETH", "ETH/USD", "ETH-USD", "eth/usd", or a numeric index.
function resolvePair(data: SocketData, query: string): PairInfo | undefined {
  const infos = Object.values(data.pairInfos);
  const q = query.trim();
  if (/^\d+$/.test(q)) {
    return infos.find((p) => p.index === Number(q));
  }
  const norm = q.toUpperCase().replace(/[-_\s]/g, "/");
  const base = norm.split("/")[0];
  // Exact "FROM/TO" match first, then fall back to matching just the base
  // asset against "FROM/USD".
  return (
    infos.find((p) => pairLabel(p).toUpperCase() === norm) ??
    infos.find((p) => p.from.toUpperCase() === base)
  );
}

// ---------- Pyth Hermes prices ----------

interface HermesParsed {
  id: string;
  price?: { price?: string; conf?: string; expo?: number; publish_time?: number };
}

function applyExpo(price?: string, expo?: number): number | null {
  if (price === undefined || expo === undefined) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return n * 10 ** expo;
}

async function fetchHermesPrices(
  feedIds: string[],
): Promise<Map<string, HermesParsed>> {
  const url = new URL(HERMES_BASE);
  for (const id of feedIds) url.searchParams.append("ids[]", id);
  const raw = (await fetchJson(url.toString())) as { parsed?: HermesParsed[] };
  const out = new Map<string, HermesParsed>();
  for (const item of raw?.parsed ?? []) {
    out.set(item.id.toLowerCase().replace(/^0x/, ""), item);
  }
  return out;
}

// ---------- tools ----------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    throw new Error(`missing required arg: ${key}`);
  }
  return String(v);
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

// Ready-to-sign EVM call data as returned by the Avantis tx-builder. `to`,
// `value`, and `data` map 1:1 onto a Base MCP `send_calls` entry. (The builder
// also returns `from`/`chainId`, but we don't read them.)
interface CallData {
  to: string;
  data: string;
  value: string;
  description?: string;
  meta?: Record<string, unknown>;
}

// Calls the Avantis tx-builder (GET-only) and unwraps its { ok, data } / error
// envelope. Throws with the server's own message on a logical failure so the
// agent can surface a useful error instead of broadcasting a bad tx.
async function buildTx(
  path: string,
  params: Record<string, string | undefined>,
): Promise<CallData> {
  const url = new URL(`${TX_BUILDER}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const raw = (await fetchJson(url.toString())) as {
    ok?: boolean;
    data?: CallData;
    error?: { code?: string; message?: string };
  };
  if (!raw?.ok || !raw.data) {
    const msg = raw?.error?.message ?? "tx-builder returned no calldata";
    throw new Error(msg);
  }
  return raw.data;
}

// Strip a CallData down to the exact { to, value, data } shape that
// bunny-agent.ts forwards into Base MCP send_calls. `value` is normalized to a
// guaranteed 0x-hex string (EIP-5792 wants hex quantities) in case the builder
// ever returns a decimal "0" / "123" instead of "0x...".
function toHexValue(v: string | undefined): string {
  if (!v) return "0x0";
  if (/^0x[0-9a-fA-F]*$/.test(v)) return v === "0x" ? "0x0" : v;
  if (/^\d+$/.test(v)) return "0x" + BigInt(v).toString(16);
  return "0x0";
}

function toSendCall(c: CallData): { to: string; value: string; data: string } {
  return { to: c.to, value: toHexValue(c.value), data: c.data || "0x" };
}

// Validates a human-decimal numeric arg is a finite positive number, returning
// the original string for the tx-builder (which wants human decimals as strings).
function posDecimal(value: string, label: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive number, got: ${value}`);
  }
  return value;
}

function feedIdOf(p: PairInfo): string | undefined {
  return p.feed?.feedId;
}

function projectPair(p: PairInfo): Json {
  return {
    index: p.index,
    pair: pairLabel(p),
    groupIndex: p.groupIndex,
    minLeverage: p.leverages?.minLeverage,
    maxLeverage: p.leverages?.maxLeverage,
    openInterest: p.openInterest,
    pairOI: p.pairOI,
    pairMaxOI: p.pairMaxOI,
    spreadP: p.spreadP,
    openFeeP: p.openFeeP,
    closeFeeP: p.closeFeeP,
    minPositionUSDC: p.minLevPosUSDC,
    feedId: feedIdOf(p),
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "avantis_pairs",
    description:
      "List all tradable Avantis perp pairs on Base with their pair index, leverage range, open interest (long/short), utilization, spread, and open/close fees. No key required. Use this to discover what can be traded and to resolve a symbol to its pair index.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max pairs to return (default all listed, sorted by index).",
        },
      },
    },
    run: async (args) => {
      const data = await getSocketData();
      const listed = Object.values(data.pairInfos)
        .filter((p) => p.isPairListed !== false)
        .sort((a, b) => a.index - b.index);
      const rawLimit = args["limit"];
      const limit =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : undefined;
      const out = (limit ? listed.slice(0, limit) : listed).map(projectPair);
      return { count: out.length, totalOpenInterest: data.totalOi, pairs: out };
    },
  },
  {
    name: "avantis_pair_info",
    description:
      "Full market detail for a single Avantis pair: open interest (long/short), utilization vs cap, hourly borrow/funding fee (long/short), leverage range (incl. zero-fee PnL tiers), spread, open/close fees, available liquidity, and minimum position size. Accepts a symbol ('ETH', 'ETH/USD') or a numeric pair index.",
    inputSchema: {
      type: "object",
      required: ["pair"],
      properties: {
        pair: {
          type: "string",
          description: "Symbol ('ETH', 'BTC/USD') or numeric pair index.",
        },
      },
    },
    run: async (args) => {
      const data = await getSocketData();
      const p = resolvePair(data, str(args, "pair"));
      if (!p) throw new Error(`Unknown Avantis pair: ${str(args, "pair")}`);
      const oi = p.pairOI ?? 0;
      const cap = p.pairMaxOI ?? 0;
      const group =
        p.groupIndex !== undefined
          ? data.groupInfo?.[String(p.groupIndex)]
          : undefined;
      return {
        index: p.index,
        pair: pairLabel(p),
        feedId: feedIdOf(p),
        openInterest: p.openInterest,
        pairOI: oi,
        pairMaxOI: cap,
        utilizationP: cap > 0 ? Number(((oi / cap) * 100).toFixed(2)) : null,
        hourlyBorrowFee: p.marginFee,
        leverages: p.leverages,
        spreadP: p.spreadP,
        openFeeP: p.openFeeP,
        closeFeeP: p.closeFeeP,
        liquidity: p.liquidity,
        minPositionUSDC: p.minLevPosUSDC,
        group,
      };
    },
  },
  {
    name: "avantis_price",
    description:
      "Live oracle price(s) for Avantis pair(s) from the Pyth price feed used by the protocol. Pass `pairs` (array of symbols) or a single `pair`. Returns price, confidence interval, and publish time per pair.",
    inputSchema: {
      type: "object",
      properties: {
        pair: { type: "string", description: "Single symbol, e.g. 'BTC/USD'." },
        pairs: {
          type: "array",
          items: { type: "string" },
          description: "Multiple symbols, e.g. ['ETH', 'BTC/USD'].",
        },
      },
    },
    run: async (args) => {
      const data = await getSocketData();
      const names: string[] = Array.isArray(args["pairs"])
        ? (args["pairs"] as unknown[]).map(String)
        : args["pair"] !== undefined && args["pair"] !== ""
          ? [String(args["pair"])]
          : [];
      if (names.length === 0) {
        throw new Error("provide `pair` or `pairs`");
      }
      const resolved = names.map((n) => ({ query: n, pair: resolvePair(data, n) }));
      const feedIds = Array.from(
        new Set(
          resolved
            .map((r) => (r.pair ? feedIdOf(r.pair) ?? "" : ""))
            .filter((f) => typeof f === "string" && f.startsWith("0x")),
        ),
      );
      const prices = feedIds.length
        ? await fetchHermesPrices(feedIds)
        : new Map<string, HermesParsed>();
      const out = resolved.map((r) => {
        if (!r.pair) return { query: r.query, error: "unknown pair" };
        const key = (feedIdOf(r.pair) ?? "").toLowerCase().replace(/^0x/, "");
        const hit = prices.get(key);
        return {
          pair: pairLabel(r.pair),
          index: r.pair.index,
          price: applyExpo(hit?.price?.price, hit?.price?.expo),
          confidence: applyExpo(hit?.price?.conf, hit?.price?.expo),
          publishTime: hit?.price?.publish_time,
        };
      });
      return { prices: out };
    },
  },
  {
    name: "avantis_positions",
    description:
      "Open Avantis positions and pending limit orders for a wallet address, including size, leverage, direction, entry, and PnL. Read-only; works for any Base wallet address. Pass `wallet` (the trader's address).",
    inputSchema: {
      type: "object",
      required: ["wallet"],
      properties: {
        wallet: {
          type: "string",
          description: "Base wallet address (0x...) to look up positions for.",
        },
      },
    },
    run: async (args) => {
      const wallet = str(args, "wallet");
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        throw new Error(`invalid wallet address: ${wallet}`);
      }
      const url = `${CORE_API_BASE}/user-data?trader=${wallet}`;
      const raw = (await fetchJson(url)) as {
        positions?: unknown[];
        limitOrders?: unknown[];
      };
      const positions = Array.isArray(raw?.positions) ? raw.positions : [];
      const limitOrders = Array.isArray(raw?.limitOrders) ? raw.limitOrders : [];
      return {
        wallet,
        openPositions: positions.length,
        pendingLimitOrders: limitOrders.length,
        positions,
        limitOrders,
      };
    },
  },
  {
    name: "avantis_prepare_open",
    description:
      "Prepare an UNSIGNED transaction batch to OPEN an Avantis leverage position (perp) on Base. Returns a `transactions` array (USDC approval + openTrade) for the agent to forward to send_calls — Bunny never broadcasts. The trader is the user's own connected wallet (no wallet arg). Collateral is USDC; min position size is 100 USDC (collateral × leverage). Use `avantis_pairs` first to confirm the pair and its leverage caps. Confirm side, collateral, and leverage with the user before calling.",
    inputSchema: {
      type: "object",
      required: ["pair", "side", "collateralUsdc", "leverage"],
      properties: {
        pair: {
          type: "string",
          description: "Pair symbol or index, e.g. 'ETH/USD', 'BTC', or '0'.",
        },
        side: {
          type: "string",
          enum: ["long", "short"],
          description: "'long' to buy, 'short' to sell.",
        },
        collateralUsdc: {
          type: "string",
          description:
            "Collateral in USDC as a human decimal (e.g. '50' = 50 USDC). Not base units.",
        },
        leverage: {
          type: "string",
          description: "Leverage multiplier, e.g. '10' for 10x. Must be within the pair's min/max.",
        },
        slippagePercent: {
          type: "string",
          description: "Allowed slippage in percent. Defaults to 1.",
        },
        orderType: {
          type: "string",
          enum: ["market", "limit", "stop_limit", "market_zero_fee"],
          description: "Defaults to 'market'. For 'limit'/'stop_limit' you must pass openPrice.",
        },
        openPrice: {
          type: "string",
          description:
            "Target entry price (human decimal). Required for limit/stop_limit; ignored for market.",
        },
        takeProfit: {
          type: "string",
          description: "Take-profit price (human decimal). Omit for none.",
        },
        stopLoss: {
          type: "string",
          description: "Stop-loss price (human decimal). Omit for none.",
        },
      },
    },
    run: async (args) => {
      const trader = await getCurrentUserWallet();
      if (!trader) {
        throw new Error(
          "no connected wallet — the user must connect their Base wallet before trading",
        );
      }
      const pair = str(args, "pair");
      const side = str(args, "side").toLowerCase();
      if (side !== "long" && side !== "short") {
        throw new Error(`invalid side: ${side} (use 'long' or 'short')`);
      }
      const collateralUsdc = posDecimal(str(args, "collateralUsdc"), "collateralUsdc");
      const leverage = posDecimal(str(args, "leverage"), "leverage");
      const orderType = optStr(args, "orderType") ?? "market";

      // USDC approval (spender is TradingStorage) MUST come before openTrade —
      // openTrade pulls collateral via transferFrom. Always include an
      // exact-amount approval; the agent forwards both in order.
      const approve = await buildTx("/token/approve", {
        trader,
        amountUsdc: collateralUsdc,
      });
      const open = await buildTx("/trade/open", {
        pair,
        trader,
        side,
        collateralUsdc,
        leverage,
        orderType,
        slippagePercent: optStr(args, "slippagePercent"),
        openPrice: optStr(args, "openPrice"),
        takeProfit: optStr(args, "takeProfit"),
        stopLoss: optStr(args, "stopLoss"),
      });

      return {
        transactions: [toSendCall(approve), toSendCall(open)],
        requirements: [
          {
            type: "approve",
            token: "USDC",
            spender: approve.to,
            amountUsdc: collateralUsdc,
            note: "USDC spending approval for Avantis — already included in transactions[0].",
          },
        ],
        summary: open.description ?? `Open ${side} ${pair} ${leverage}x with ${collateralUsdc} USDC`,
        validation: open.meta?.validation,
      };
    },
  },
  {
    name: "avantis_prepare_close",
    description:
      "Prepare an UNSIGNED transaction to CLOSE (fully or partially) an open Avantis position at market. Returns a `transactions` array for the agent to forward to send_calls — Bunny never broadcasts. The trader is the user's own connected wallet (no wallet arg). Identify the position by `pair` + `tradeIndex` (the per-pair `index` from avantis_positions). Omit `collateralUsdc` to close the whole position; pass it to close part of it. Call avantis_positions first to read the position and its index.",
    inputSchema: {
      type: "object",
      required: ["pair", "tradeIndex"],
      properties: {
        pair: {
          type: "string",
          description: "Pair symbol or index of the position, e.g. 'ETH/USD' or '0'.",
        },
        tradeIndex: {
          type: "string",
          description:
            "Per-pair trade index (the `index` field from avantis_positions), e.g. '0' or '1'.",
        },
        collateralUsdc: {
          type: "string",
          description:
            "Collateral to close in USDC (human decimal). Omit to close the full position.",
        },
      },
    },
    run: async (args) => {
      const trader = await getCurrentUserWallet();
      if (!trader) {
        throw new Error(
          "no connected wallet — the user must connect their Base wallet before trading",
        );
      }
      const pairArg = str(args, "pair");
      const tradeIndex = str(args, "tradeIndex");
      if (!/^\d+$/.test(tradeIndex)) {
        throw new Error(`invalid tradeIndex: ${tradeIndex} (expected a number)`);
      }

      // Resolve the numeric pair index so we can both call the builder and
      // (for full closes) look up the position's collateral on the core API.
      const data = await getSocketData();
      const resolved = resolvePair(data, pairArg);
      if (!resolved) {
        throw new Error(`unknown Avantis pair: ${pairArg}`);
      }
      const pairIndex = resolved.index;

      // Full close = the position's entire collateral. The core API reports it
      // in 6-decimal base units; the builder wants a human decimal.
      let collateralUsdc = optStr(args, "collateralUsdc");
      if (collateralUsdc) collateralUsdc = posDecimal(collateralUsdc, "collateralUsdc");
      if (!collateralUsdc) {
        const raw = (await fetchJson(
          `${CORE_API_BASE}/user-data?trader=${trader}`,
        )) as { positions?: Array<Record<string, unknown>> };
        const positions = Array.isArray(raw?.positions) ? raw.positions : [];
        const pos = positions.find(
          (p) =>
            Number(p.pairIndex) === pairIndex && Number(p.index) === Number(tradeIndex),
        );
        if (!pos) {
          throw new Error(
            `no open ${pairLabel(resolved)} position at index ${tradeIndex} for this wallet`,
          );
        }
        const base = Number(pos.collateral);
        if (!Number.isFinite(base) || base <= 0) {
          throw new Error("could not read the position's collateral from the core API");
        }
        collateralUsdc = String(base / 1e6);
      }

      const close = await buildTx("/trade/close", {
        pairIndex: String(pairIndex),
        tradeIndex,
        trader,
        collateralUsdc,
      });

      return {
        transactions: [toSendCall(close)],
        summary:
          close.description ??
          `Close ${pairLabel(resolved)} position #${tradeIndex} (${collateralUsdc} USDC collateral)`,
      };
    },
  },
];

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listAvantisTools(): AvantisTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findAvantisTool(name: string): boolean {
  return toolIndex.has(name);
}

export function avantisStatus(): { connected: boolean; toolCount: number } {
  // Public, keyless endpoints — always considered connected.
  return { connected: true, toolCount: TOOLS.length };
}

export async function callAvantisTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolIndex.get(name);
  if (!tool) {
    return { isError: true, content: `Unknown Avantis tool: ${name}` };
  }
  try {
    const result = await tool.run(args ?? {});
    return { isError: false, content: JSON.stringify(result) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, err }, "Avantis tool failed");
    return { isError: true, content: `Avantis request failed: ${message}` };
  }
}
