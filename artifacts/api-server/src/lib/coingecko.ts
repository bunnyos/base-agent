import { logger } from "./logger";
import { getCoingeckoApiKey } from "./settings";

// CoinGecko DEMO API. This single lib consolidates what used to be three
// separate integrations: CoinMarketCap (CEX market data), DexScreener (onchain
// DEX pairs), and GeckoTerminal (Bankr-launch enrichment).
//
// Both surfaces REQUIRE the per-user CoinGecko Demo API key (header
// `x-cg-demo-api-key`); there is no keyless fallback. Each cloud user brings
// their own free key (https://www.coingecko.com/en/api/pricing — Demo plan,
// 30 calls/min).
//   - CEX endpoints     (api.coingecko.com/api/v3)
//   - Onchain endpoints (CoinGecko's GeckoTerminal proxy under /onchain)
//
// Docs: https://docs.coingecko.com/reference/introduction
const CEX_BASE = "https://api.coingecko.com/api/v3";
const ONCHAIN_CG_BASE = "https://api.coingecko.com/api/v3/onchain";
const DEMO_HEADER = "x-cg-demo-api-key";
const DEFAULT_NETWORK = "base";

const NOT_CONFIGURED_MSG =
  "CoinGecko is not configured. Add a free Demo-plan key (no card required) at https://www.coingecko.com/en/api/pricing and paste it into Configure → llm → coingecko api key.";

export interface CoinGeckoTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type ToolKind = "cex" | "onchain";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  kind: ToolKind;
  build: (args: Record<string, unknown>) => {
    path: string;
    query: Record<string, string | string[]>;
  };
}

function pick(
  args: Record<string, unknown>,
  keys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = args[k];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[k] = v.join(",");
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// GeckoTerminal reports `reserve_in_usd` as a tiny negative number for the fresh
// Uniswap v4 "doppler" pools most Bankr launches use (its indexer computes a net
// reserve that lands on floating-point noise below zero). Liquidity can never be
// negative, so clamp those to 0 — they're effectively zero-liquidity pools.
function liqNum(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.max(0, n);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((a) => String(a)).filter(Boolean) : [];
}

// Pull a window value (e.g. price_change_percentage.h24) tolerating absence.
function win(obj: unknown, key: string): number | null {
  if (obj && typeof obj === "object") {
    return num((obj as Record<string, unknown>)[key]);
  }
  return null;
}

const TOOLS: ToolDef[] = [
  {
    name: "coingecko_price",
    description:
      "Latest market price for one or more coins by CoinGecko coin id (e.g. 'ethereum','bitcoin','usd-coin'). Returns price plus (by default) market cap, 24h volume, and 24h percent change in the requested vs_currencies. If you only have a ticker symbol or name, call coingecko_search first to resolve the canonical coin id.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "CoinGecko coin ids, e.g. ['ethereum','bitcoin','aerodrome-finance'].",
        },
        vs_currencies: {
          type: "string",
          description: "Comma-separated target currencies. Default 'usd'.",
        },
      },
    },
    kind: "cex",
    build: (args) => ({
      path: "/simple/price",
      query: {
        ids: asArray(args["ids"]).join(","),
        vs_currencies: (args["vs_currencies"] as string) || "usd",
        include_market_cap: "true",
        include_24hr_vol: "true",
        include_24hr_change: "true",
      },
    }),
  },
  {
    name: "coingecko_token_price",
    description:
      "Latest USD (or other vs_currency) price for one or more on-chain ERC20 tokens by contract address. Defaults to the Base network. Returns price, market cap, 24h volume, and 24h percent change. Use this when you have a contract address rather than a CoinGecko coin id.",
    inputSchema: {
      type: "object",
      required: ["contract_addresses"],
      properties: {
        contract_addresses: {
          type: "array",
          items: { type: "string" },
          description: "ERC20 contract addresses (0x-prefixed).",
        },
        platform: {
          type: "string",
          description:
            "CoinGecko asset platform id, e.g. 'base', 'ethereum'. Default 'base'.",
        },
        vs_currencies: {
          type: "string",
          description: "Comma-separated target currencies. Default 'usd'.",
        },
      },
    },
    kind: "cex",
    build: (args) => {
      const platform = (args["platform"] as string) || DEFAULT_NETWORK;
      return {
        path: `/simple/token_price/${platform}`,
        query: {
          contract_addresses: asArray(args["contract_addresses"]).join(","),
          vs_currencies: (args["vs_currencies"] as string) || "usd",
          include_market_cap: "true",
          include_24hr_vol: "true",
          include_24hr_change: "true",
        },
      };
    },
  },
  {
    name: "coingecko_markets",
    description:
      "Top coins ranked by market cap (or other sorts) with price, market cap + rank, fully diluted valuation, 24h volume, 24h high/low, percent change, supply, ath/atl. Supports pagination (page/per_page), order, filtering to specific ids, and category (e.g. 'base-ecosystem','meme-token','stablecoins'). Pass price_change_percentage like '1h,24h,7d' for extra change windows.",
    inputSchema: {
      type: "object",
      properties: {
        vs_currency: { type: "string", description: "Quote currency. Default 'usd'." },
        order: {
          type: "string",
          description:
            "One of: market_cap_desc, market_cap_asc, volume_desc, volume_asc, id_asc, id_desc. Default 'market_cap_desc'.",
        },
        per_page: { type: "number", description: "1-250. Default 100." },
        page: { type: "number", description: "1-based page. Default 1." },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these CoinGecko coin ids.",
        },
        category: {
          type: "string",
          description:
            "CoinGecko category id to filter by, e.g. 'base-ecosystem', 'meme-token', 'stablecoins'.",
        },
        price_change_percentage: {
          type: "string",
          description: "Comma-separated extra windows, e.g. '1h,24h,7d'.",
        },
      },
    },
    kind: "cex",
    build: (args) => ({
      path: "/coins/markets",
      query: {
        vs_currency: (args["vs_currency"] as string) || "usd",
        order: (args["order"] as string) || "market_cap_desc",
        per_page: String(args["per_page"] ?? 100),
        page: String(args["page"] ?? 1),
        sparkline: "false",
        ...pick(args, ["ids", "category", "price_change_percentage"]),
      },
    }),
  },
  {
    name: "coingecko_coin_info",
    description:
      "Full metadata for a single coin by CoinGecko coin id: description, homepage/twitter/github/explorer links, image, categories, contract addresses across chains (platforms), market cap rank, and a market_data snapshot (price, market cap, volume, 24h change, supply, ath/atl). Resolve the id with coingecko_search if you only have a symbol or name.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "CoinGecko coin id, e.g. 'ethereum'." },
      },
    },
    kind: "cex",
    build: (args) => ({
      path: `/coins/${String(args["id"] ?? "").trim()}`,
      query: {
        localization: "false",
        tickers: "false",
        market_data: "true",
        community_data: "false",
        developer_data: "false",
        sparkline: "false",
      },
    }),
  },
  {
    name: "coingecko_search",
    description:
      "Search CoinGecko for coins, categories, and exchanges by name, symbol, or partial text. Returns matching coins with their canonical coin id, name, symbol, and market cap rank. Use this to resolve a ticker (e.g. 'AERO') to the coin id required by coingecko_price / coingecko_coin_info.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search text." },
      },
    },
    kind: "cex",
    build: (args) => ({
      path: "/search",
      query: { query: String(args["query"] ?? "") },
    }),
  },
  {
    name: "coingecko_trending",
    description:
      "Currently trending coins on CoinGecko (most searched in the last 24h), plus trending categories. Each coin includes its coin id, name, symbol, market cap rank, price, and 24h price change. Use this for discovery / 'what's hot right now'.",
    inputSchema: { type: "object", properties: {} },
    kind: "cex",
    build: () => ({ path: "/search/trending", query: {} }),
  },
  {
    name: "coingecko_global",
    description:
      "Global crypto market snapshot: total market cap and 24h volume (per currency), BTC/ETH market cap dominance, number of active cryptocurrencies and markets, and 24h market cap percent change.",
    inputSchema: { type: "object", properties: {} },
    kind: "cex",
    build: () => ({ path: "/global", query: {} }),
  },
  {
    name: "coingecko_onchain_token_data",
    description:
      "Live on-chain DEX data for one or more token contract addresses (up to 30) on a network (default base): price_usd, market cap / fdv, total liquidity (total_reserve_in_usd), and 24h volume. Indexes brand-new launches fast, so it's the price/liquidity oracle for fresh tokens that aren't on the main CoinGecko market list yet. Requires the CoinGecko Demo API key.",
    inputSchema: {
      type: "object",
      required: ["addresses"],
      properties: {
        addresses: {
          type: "array",
          items: { type: "string" },
          description: "Token contract addresses (0x-prefixed). Up to 30 per call.",
        },
        network: {
          type: "string",
          description: "Network id, e.g. 'base', 'eth'. Default 'base'.",
        },
      },
    },
    kind: "onchain",
    build: (args) => {
      const network = (args["network"] as string) || DEFAULT_NETWORK;
      const addrs = asArray(args["addresses"]).slice(0, 30);
      if (addrs.length === 0) {
        throw new Error("coingecko_onchain_token_data requires at least one address");
      }
      return {
        path: `/networks/${network}/tokens/multi/${addrs.join(",")}`,
        query: {},
      };
    },
  },
  {
    name: "coingecko_onchain_search_pools",
    description:
      "Search on-chain DEX liquidity pools by token name, symbol, or contract address. Returns matching pools (default base network) with pool name, base/quote token, price_usd, liquidity (reserve_in_usd), 24h volume, and 24h price change. Requires the CoinGecko Demo API key.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search text: token name, symbol, or address." },
        network: {
          type: "string",
          description: "Network id to filter by, e.g. 'base'. Default 'base'.",
        },
      },
    },
    kind: "onchain",
    build: (args) => ({
      path: "/search/pools",
      query: {
        query: String(args["query"] ?? ""),
        network: (args["network"] as string) || DEFAULT_NETWORK,
      },
    }),
  },
];

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listCoinGeckoTools(): CoinGeckoTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findCoinGeckoTool(name: string): boolean {
  return toolIndex.has(name);
}

export function coinGeckoStatus(): { connected: boolean; toolCount: number } {
  // Every tool (CEX and onchain) requires the demo key — there is no keyless
  // fallback. Report connected on key presence.
  return {
    connected: Boolean(getCoingeckoApiKey()),
    toolCount: TOOLS.length,
  };
}

function buildUrl(
  base: string,
  path: string,
  query: Record<string, string | string[]>,
): string {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function cexFetch(
  apiKey: string,
  path: string,
  query: Record<string, string | string[]>,
  toolName: string,
): Promise<{ content: string; isError: boolean }> {
  // Defensive: a key that slipped past save-time sanitization could carry a
  // smart quote or NBSP. fetch headers must be ASCII or the call throws deep
  // inside fetch. Trip on it explicitly instead.
  if (/[^\x20-\x7E]/.test(apiKey)) {
    return {
      isError: true,
      content:
        "Your saved CoinGecko key contains a non-ASCII character (likely a smart quote from paste). Open Configure → llm → coingecko api key, delete it, and paste a fresh copy.",
    };
  }
  const url = buildUrl(CEX_BASE, path, query);
  try {
    const resp = await fetch(url, {
      headers: { accept: "application/json", [DEMO_HEADER]: apiKey },
    });
    const text = await resp.text();
    if (!resp.ok) {
      logger.warn(
        { tool: toolName, status: resp.status, body: text.slice(0, 500) },
        "CoinGecko API error",
      );
      if (resp.status === 401 || resp.status === 403) {
        return {
          isError: true,
          content:
            "CoinGecko rejected the API key (401/403). The key is invalid or not a Demo-plan key. Get a free Demo key at coingecko.com/en/api/pricing and paste it into Configure → llm → coingecko api key. Make sure you're using a demo key (header x-cg-demo-api-key), not a Pro key.",
        };
      }
      if (resp.status === 429) {
        return {
          isError: true,
          content:
            "CoinGecko rate limit hit (Demo tier: ~30 req/min, 10k/month). Wait a minute and retry, or batch ids into a single call (coingecko_price accepts arrays).",
        };
      }
      return {
        isError: true,
        content: `CoinGecko ${resp.status}: ${text.slice(0, 1000)}`,
      };
    }
    return { isError: false, content: projectCex(toolName, text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: toolName, err }, "CoinGecko fetch failed");
    return { isError: true, content: `CoinGecko request failed: ${message}` };
  }
}

// CEX payloads for some endpoints are very large (a single /coins/{id} is tens
// of KB). Project the big ones to the fields the agent actually uses; pass the
// small ones through verbatim.
function projectCex(toolName: string, text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  try {
    if (toolName === "coingecko_markets") {
      const arr = Array.isArray(parsed) ? parsed : [];
      return JSON.stringify(arr.map(projectMarket));
    }
    if (toolName === "coingecko_coin_info") {
      return JSON.stringify(projectCoinInfo(parsed));
    }
    if (toolName === "coingecko_search") {
      return JSON.stringify(projectSearch(parsed));
    }
    if (toolName === "coingecko_trending") {
      return JSON.stringify(projectTrending(parsed));
    }
  } catch (err) {
    logger.warn({ tool: toolName, err }, "CoinGecko projection failed");
    return text;
  }
  return text;
}

function projectMarket(raw: unknown): Record<string, unknown> {
  const m = (raw as Record<string, unknown>) ?? {};
  const out: Record<string, unknown> = {
    id: str(m["id"]),
    symbol: str(m["symbol"]),
    name: str(m["name"]),
    image: str(m["image"]) || null,
    current_price: num(m["current_price"]),
    market_cap: num(m["market_cap"]),
    market_cap_rank: num(m["market_cap_rank"]),
    fully_diluted_valuation: num(m["fully_diluted_valuation"]),
    total_volume: num(m["total_volume"]),
    high_24h: num(m["high_24h"]),
    low_24h: num(m["low_24h"]),
    price_change_percentage_24h: num(m["price_change_percentage_24h"]),
    circulating_supply: num(m["circulating_supply"]),
    total_supply: num(m["total_supply"]),
    max_supply: num(m["max_supply"]),
    ath: num(m["ath"]),
    atl: num(m["atl"]),
    last_updated: str(m["last_updated"]) || null,
  };
  // Pass through any requested extra windows (price_change_percentage_*_in_currency).
  for (const [k, v] of Object.entries(m)) {
    if (k.endsWith("_in_currency")) out[k] = num(v);
  }
  return out;
}

function projectCoinInfo(raw: unknown): Record<string, unknown> {
  const c = (raw as Record<string, unknown>) ?? {};
  const links = (c["links"] as Record<string, unknown>) ?? {};
  const image = (c["image"] as Record<string, unknown>) ?? {};
  const desc = (c["description"] as Record<string, unknown>) ?? {};
  const md = (c["market_data"] as Record<string, unknown>) ?? {};
  const cp = (md["current_price"] as Record<string, unknown>) ?? {};
  const mc = (md["market_cap"] as Record<string, unknown>) ?? {};
  const tv = (md["total_volume"] as Record<string, unknown>) ?? {};
  return {
    id: str(c["id"]),
    symbol: str(c["symbol"]),
    name: str(c["name"]),
    description: str(desc["en"]).slice(0, 1500),
    categories: Array.isArray(c["categories"]) ? c["categories"] : [],
    image: str(image["small"]) || str(image["thumb"]) || null,
    market_cap_rank: num(c["market_cap_rank"]),
    platforms: c["platforms"] ?? {},
    links: {
      homepage: Array.isArray(links["homepage"])
        ? (links["homepage"] as unknown[]).map(String).filter(Boolean)
        : [],
      twitter_screen_name: str(links["twitter_screen_name"]) || null,
      repos_url: links["repos_url"] ?? null,
      blockchain_site: Array.isArray(links["blockchain_site"])
        ? (links["blockchain_site"] as unknown[]).map(String).filter(Boolean).slice(0, 5)
        : [],
    },
    market_data: {
      current_price_usd: num(cp["usd"]),
      market_cap_usd: num(mc["usd"]),
      total_volume_usd: num(tv["usd"]),
      price_change_percentage_24h: num(md["price_change_percentage_24h"]),
      circulating_supply: num(md["circulating_supply"]),
      total_supply: num(md["total_supply"]),
      max_supply: num(md["max_supply"]),
      ath_usd: num((md["ath"] as Record<string, unknown>)?.["usd"]),
      atl_usd: num((md["atl"] as Record<string, unknown>)?.["usd"]),
    },
    genesis_date: str(c["genesis_date"]) || null,
    last_updated: str(c["last_updated"]) || null,
  };
}

function projectSearch(raw: unknown): Record<string, unknown> {
  const s = (raw as Record<string, unknown>) ?? {};
  const coins = Array.isArray(s["coins"]) ? s["coins"] : [];
  const categories = Array.isArray(s["categories"]) ? s["categories"] : [];
  return {
    coins: coins.slice(0, 25).map((raw2) => {
      const c = (raw2 as Record<string, unknown>) ?? {};
      return {
        id: str(c["id"]),
        name: str(c["name"]),
        symbol: str(c["symbol"]),
        market_cap_rank: num(c["market_cap_rank"]),
        thumb: str(c["thumb"]) || null,
      };
    }),
    categories: categories.slice(0, 15).map((raw2) => {
      const c = (raw2 as Record<string, unknown>) ?? {};
      return { id: str(c["id"] ?? c["category_id"]), name: str(c["name"]) };
    }),
  };
}

function projectTrending(raw: unknown): Record<string, unknown> {
  const t = (raw as Record<string, unknown>) ?? {};
  const coins = Array.isArray(t["coins"]) ? t["coins"] : [];
  const categories = Array.isArray(t["categories"]) ? t["categories"] : [];
  return {
    coins: coins.map((raw2) => {
      const wrapper = (raw2 as Record<string, unknown>) ?? {};
      const c = (wrapper["item"] as Record<string, unknown>) ?? {};
      const data = (c["data"] as Record<string, unknown>) ?? {};
      return {
        id: str(c["id"]),
        name: str(c["name"]),
        symbol: str(c["symbol"]),
        market_cap_rank: num(c["market_cap_rank"]),
        thumb: str(c["thumb"]) || null,
        price_usd: num(data["price"]),
        price_change_percentage_24h_usd: win(
          data["price_change_percentage_24h"],
          "usd",
        ),
      };
    }),
    categories: categories.slice(0, 15).map((raw2) => {
      const c = (raw2 as Record<string, unknown>) ?? {};
      return { id: str(c["id"]), name: str(c["name"]) };
    }),
  };
}

// --- Onchain (GeckoTerminal proxy) ---------------------------------------
// CoinGecko proxies GeckoTerminal under /onchain. This requires the demo key
// just like the CEX endpoints — there is no keyless fallback. Returns null when
// no usable key is configured so callers can surface a not-configured error.

function onchainTarget(): { base: string; headers: Record<string, string> } | null {
  const apiKey = getCoingeckoApiKey();
  if (!apiKey || /[^\x20-\x7E]/.test(apiKey)) return null;
  return {
    base: ONCHAIN_CG_BASE,
    headers: { accept: "application/json", [DEMO_HEADER]: apiKey },
  };
}

const MAX_POOLS = 20;

async function onchainFetch(
  path: string,
  query: Record<string, string | string[]>,
  toolName: string,
): Promise<{ content: string; isError: boolean }> {
  const target = onchainTarget();
  if (!target) {
    return { isError: true, content: NOT_CONFIGURED_MSG };
  }
  const { base, headers } = target;
  const url = buildUrl(base, path, query);
  try {
    const resp = await fetch(url, { headers });
    const text = await resp.text();
    if (!resp.ok) {
      logger.warn(
        { tool: toolName, status: resp.status, body: text.slice(0, 500) },
        "CoinGecko onchain API error",
      );
      return {
        isError: true,
        content: `CoinGecko onchain ${resp.status}: ${text.slice(0, 1000)}`,
      };
    }
    if (toolName === "coingecko_onchain_token_data") {
      return { isError: false, content: JSON.stringify(projectOnchainTokens(text)) };
    }
    if (toolName === "coingecko_onchain_search_pools") {
      return { isError: false, content: JSON.stringify(projectOnchainPools(text)) };
    }
    return { isError: false, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: toolName, err }, "CoinGecko onchain fetch failed");
    return { isError: true, content: `CoinGecko onchain request failed: ${message}` };
  }
}

function projectOnchainTokens(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { tokens: [] };
  }
  const list =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["data"]
      : null;
  const tokens: Record<string, unknown>[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const attrs = (item as Record<string, unknown>)?.["attributes"];
      if (!attrs || typeof attrs !== "object") continue;
      const a = attrs as Record<string, unknown>;
      tokens.push({
        address: str(a["address"]),
        name: str(a["name"]),
        symbol: str(a["symbol"]),
        priceUsd: num(a["price_usd"]),
        marketCap: num(a["market_cap_usd"]) ?? num(a["fdv_usd"]),
        fdv: num(a["fdv_usd"]),
        liquidityUsd: liqNum(a["total_reserve_in_usd"]),
        volume24h: win(a["volume_usd"], "h24"),
        coingeckoCoinId: str(a["coingecko_coin_id"]) || null,
      });
    }
  }
  return { tokens };
}

function projectOnchainPools(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { pools: [] };
  }
  const list =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["data"]
      : null;
  const pools: Record<string, unknown>[] = [];
  if (Array.isArray(list)) {
    for (const item of list.slice(0, MAX_POOLS)) {
      const attrs = (item as Record<string, unknown>)?.["attributes"];
      if (!attrs || typeof attrs !== "object") continue;
      const a = attrs as Record<string, unknown>;
      pools.push({
        name: str(a["name"]),
        address: str(a["address"]),
        priceUsd: num(a["base_token_price_usd"]),
        liquidityUsd: liqNum(a["reserve_in_usd"]),
        fdv: num(a["fdv_usd"]),
        marketCap: num(a["market_cap_usd"]) ?? num(a["fdv_usd"]),
        volume24h: win(a["volume_usd"], "h24"),
        priceChange1h: win(a["price_change_percentage"], "h1"),
        priceChange24h: win(a["price_change_percentage"], "h24"),
        poolCreatedAt: str(a["pool_created_at"]) || null,
      });
    }
  }
  return { pools };
}

export async function callCoinGeckoTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolIndex.get(name);
  if (!tool) {
    return { isError: true, content: `Unknown CoinGecko tool: ${name}` };
  }
  let path: string;
  let query: Record<string, string | string[]>;
  try {
    ({ path, query } = tool.build(args));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: `Failed to build CoinGecko request: ${message}`,
    };
  }
  if (tool.kind === "onchain") {
    return onchainFetch(path, query, name);
  }
  const apiKey = getCoingeckoApiKey();
  if (!apiKey) {
    return { isError: true, content: NOT_CONFIGURED_MSG };
  }
  return cexFetch(apiKey, path, query, name);
}

// --- Enrichment helper ----------------------------------------------------
// Used by the tokens-hunt route to fill market columns for Bankr launches by
// their exact pool id. Uses the CoinGecko demo onchain proxy (pools/multi),
// the same source as every other onchain tool here — requires the per-user
// demo key, no keyless fallback. Querying by pool id (rather than token
// address) returns real liquidity for the Uniswap v4 "doppler" pools most
// Bankr tokens launch into.

export interface CoinGeckoMarketData {
  usdPrice: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  pricePercentChange1h: number | null;
  pricePercentChange24h: number | null;
  totalVolume24h: number | null;
}

export interface CoinGeckoMarketResult {
  // Market data keyed by lowercased pool id for every pool that resolved.
  data: Map<string, CoinGeckoMarketData>;
  // Pool ids whose batch fetch actually succeeded (HTTP ok + parseable). Only
  // these are safe to negative-cache; a transient failure leaves an id out so
  // the caller can retry instead of suppressing it for the whole TTL.
  queried: Set<string>;
}

export async function getCoinGeckoPoolData(
  poolIds: string[],
  network: string = DEFAULT_NETWORK,
): Promise<CoinGeckoMarketResult> {
  const data = new Map<string, CoinGeckoMarketData>();
  const queried = new Set<string>();
  const unique = Array.from(new Set(poolIds.map((p) => p))).filter(Boolean);
  const target = onchainTarget();
  if (!target) return { data, queried };
  const { base, headers } = target;

  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    let parsed: unknown;
    try {
      const url = `${base}/networks/${network}/pools/multi/${chunk.join(",")}`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        logger.warn({ status: resp.status }, "CoinGecko pools/multi error");
        continue;
      }
      parsed = JSON.parse(await resp.text());
    } catch (err) {
      logger.warn({ err }, "CoinGecko pools/multi fetch failed");
      continue;
    }
    const list =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)["data"]
        : null;
    if (!Array.isArray(list)) continue;
    // Fetch + parse succeeded: every id in this chunk was genuinely checked,
    // so it's safe to negative-cache the ones with no pool.
    for (const id of chunk) queried.add(id.toLowerCase());

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const attrs = (item as Record<string, unknown>)["attributes"];
      if (!attrs || typeof attrs !== "object") continue;
      const a = attrs as Record<string, unknown>;
      const addr =
        typeof a["address"] === "string" ? (a["address"] as string).toLowerCase() : "";
      if (!addr) continue;
      data.set(addr, {
        usdPrice: num(a["base_token_price_usd"]),
        liquidityUsd: liqNum(a["reserve_in_usd"]),
        marketCap: num(a["market_cap_usd"]) ?? num(a["fdv_usd"]),
        pricePercentChange1h: win(a["price_change_percentage"], "h1"),
        pricePercentChange24h: win(a["price_change_percentage"], "h24"),
        totalVolume24h: win(a["volume_usd"], "h24"),
      });
    }
  }
  return { data, queried };
}

// Per-token onchain data from the CoinGecko tokens/multi endpoint.
export interface CoinGeckoTokenOnchain {
  // Most-liquid ("top") pool address, lowercased. Used to enrich tokens whose
  // upstream-provided pool address is unreliable (e.g. virtuals sometimes
  // reports the token address itself as the LP). null when no indexed pool.
  pool: string | null;
  // Token-level 24h volume in USD, **aggregated across all of the token's
  // pools** on this network. This is the token's true onchain volume — unlike a
  // single pool's volume_usd.h24, which only covers one DEX pair.
  volume24h: number | null;
}

// Fetch per-token onchain data (top pool + aggregated 24h volume) for a batch of
// token contract addresses via the CoinGecko onchain tokens/multi endpoint.
// Returns Map<tokenAddrLower, CoinGeckoTokenOnchain> for tokens CoinGecko has
// indexed. Requires the demo key.
export async function getCoinGeckoTokenOnchain(
  tokenAddresses: string[],
  network: string = DEFAULT_NETWORK,
): Promise<Map<string, CoinGeckoTokenOnchain>> {
  const out = new Map<string, CoinGeckoTokenOnchain>();
  const unique = Array.from(
    new Set(tokenAddresses.map((a) => a.toLowerCase())),
  ).filter(Boolean);
  const target = onchainTarget();
  if (!target) return out;
  const { base, headers } = target;

  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    let parsed: unknown;
    try {
      const url = `${base}/networks/${network}/tokens/multi/${chunk.join(",")}`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        logger.warn({ status: resp.status }, "CoinGecko tokens/multi error");
        continue;
      }
      parsed = JSON.parse(await resp.text());
    } catch (err) {
      logger.warn({ err }, "CoinGecko tokens/multi fetch failed");
      continue;
    }
    const list =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)["data"]
        : null;
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const attrsRaw = o["attributes"];
      const a =
        attrsRaw && typeof attrsRaw === "object"
          ? (attrsRaw as Record<string, unknown>)
          : null;
      const addr =
        a && typeof a["address"] === "string" ? (a["address"] as string).toLowerCase() : "";
      if (!addr) continue;
      // Token-level aggregate 24h volume across every pool of this token.
      const volume24h = a ? win(a["volume_usd"], "h24") : null;
      const rel = o["relationships"];
      const topPools =
        rel && typeof rel === "object"
          ? (rel as Record<string, unknown>)["top_pools"]
          : null;
      const poolData =
        topPools && typeof topPools === "object"
          ? (topPools as Record<string, unknown>)["data"]
          : null;
      const first = Array.isArray(poolData) && poolData.length > 0 ? poolData[0] : null;
      const rawId =
        first && typeof first === "object"
          ? (first as Record<string, unknown>)["id"]
          : null;
      // Pool ids come back as "<network>_<poolAddress>" — strip the prefix.
      const poolAddr =
        typeof rawId === "string" && rawId
          ? (rawId.includes("_") ? rawId.slice(rawId.indexOf("_") + 1) : rawId).toLowerCase()
          : null;
      out.set(addr, { pool: poolAddr, volume24h });
    }
  }
  return out;
}

// --- OHLCV chart data -----------------------------------------------------
// One close-price + volume point per candle, charted into the downloadable PDF
// report (the on-screen chart is a cross-origin GeckoTerminal iframe that can't
// be embedded in a PDF). Sourced from the CoinGecko demo onchain proxy only.
export interface CoinGeckoOhlcvPoint {
  t: number; // unix seconds (candle open time)
  c: number; // close price, usd
  v: number; // volume, usd
}

// Best-effort daily OHLCV for a single token, used to draw the static price
// chart in the PDF. Resolves the token's highest-liquidity pool, then pulls
// OHLCV from CoinGecko's onchain (GeckoTerminal proxy) endpoint. Requires the
// per-user demo key; returns [] on any failure or when unconfigured so the
// caller can omit the chart gracefully.
export async function getCoinGeckoTokenOhlcv(
  address: string,
  network: string = DEFAULT_NETWORK,
  opts: { timeframe?: "day" | "hour"; limit?: number } = {},
): Promise<CoinGeckoOhlcvPoint[]> {
  const target = onchainTarget();
  if (!target) return [];
  const { base, headers } = target;
  const timeframe = opts.timeframe ?? "day";
  const limit = Math.min(Math.max(opts.limit ?? 30, 2), 100);

  // 1. Resolve the token's top pool (CoinGecko returns them sorted by
  //    liquidity, so the first entry is the deepest/most representative pool).
  let poolAddress = "";
  try {
    const url = `${base}/networks/${network}/tokens/${address}/pools?page=1`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "CoinGecko token pools error");
      return [];
    }
    const parsed = JSON.parse(await resp.text());
    const list =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)["data"]
        : null;
    if (Array.isArray(list) && list.length > 0) {
      const attrs = (list[0] as Record<string, unknown>)?.["attributes"];
      poolAddress = str((attrs as Record<string, unknown>)?.["address"]);
    }
  } catch (err) {
    logger.warn({ err }, "CoinGecko token pools fetch failed");
    return [];
  }
  if (!poolAddress) return [];

  // 2. Pull OHLCV for that pool. The endpoint returns candles newest-first.
  try {
    const url = `${base}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}&currency=usd`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "CoinGecko ohlcv error");
      return [];
    }
    const parsed = JSON.parse(await resp.text());
    const attrs = (
      (parsed as Record<string, unknown>)?.["data"] as Record<string, unknown>
    )?.["attributes"] as Record<string, unknown> | undefined;
    const ohlcv = attrs?.["ohlcv_list"];
    if (!Array.isArray(ohlcv)) return [];
    const points: CoinGeckoOhlcvPoint[] = [];
    for (const row of ohlcv) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const t = num(row[0]);
      const c = num(row[4]);
      const v = num(row[5]);
      if (t === null || c === null) continue;
      points.push({ t, c, v: v ?? 0 });
    }
    // Return chronological (oldest → newest) for left-to-right charting.
    points.sort((a, b) => a.t - b.t);
    return points;
  } catch (err) {
    logger.warn({ err }, "CoinGecko ohlcv fetch failed");
    return [];
  }
}
