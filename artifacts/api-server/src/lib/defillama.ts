import { logger } from "./logger";

// DeFi Llama free API. Two hosts:
//   - api.llama.fi    → TVL, DEX volumes, fees, yields, stablecoins
//   - coins.llama.fi  → token prices / coins endpoints
// No API key required for the free tier. The pro host
// (pro-api.llama.fi) and its endpoints are intentionally out of scope.
//
// Tool surface is deliberately narrow (~10 tools) so the agent isn't
// overwhelmed by similar endpoints. Removed in a prior trim:
//   - historical chain TVL series (use defillama_protocol for protocol history)
//   - per-coin historical / batch / percentage / first / block lookups
//   - per-chain DEX / fees variants + summary endpoints
//   - options + open-interest overviews
//   - stablecoin history endpoints (only the snapshot list is kept)
// If one of these is genuinely needed later, re-add it with the same
// shape — don't reach for raw fetch from the agent.
const TVL_BASE = "https://api.llama.fi";
const COINS_BASE = "https://coins.llama.fi";
const YIELDS_BASE = "https://yields.llama.fi";
const STABLECOINS_BASE = "https://stablecoins.llama.fi";

export interface DefiLlamaTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type Host = "tvl" | "coins" | "yields" | "stablecoins";

interface BuiltRequest {
  host: Host;
  path: string;
  query: Record<string, string>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  build: (args: Record<string, unknown>) => BuiltRequest;
  // Optional server-side trimming/projection so large list payloads don't
  // overflow the model's context window. Receives parsed JSON and the
  // original args (where a `limit` arg may live). Returns the trimmed value
  // to re-serialize.
  trim?: (parsed: unknown, args: Record<string, unknown>) => unknown;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    throw new Error(`missing required arg: ${key}`);
  }
  return String(v);
}

function pickQuery(
  args: Record<string, unknown>,
  keys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = args[k];
    if (v === undefined || v === null || v === "") continue;
    out[k] = String(v);
  }
  return out;
}

function clampLimit(
  args: Record<string, unknown>,
  fallback: number,
  max = 500,
): number {
  const raw = args["limit"];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// Generic projection helper: keep only listed keys per item. Skip if no
// projection list is given.
function project<T extends Record<string, unknown>>(
  arr: T[],
  keys: string[],
): Array<Record<string, unknown>> {
  return arr.map((item) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in item) out[k] = item[k];
    return out;
  });
}

const PROTOCOLS_FIELDS = [
  "id",
  "name",
  "slug",
  "symbol",
  "chain",
  "chains",
  "category",
  "tvl",
  "change_1d",
  "change_7d",
  "mcap",
  "url",
];

const POOLS_FIELDS = [
  "pool",
  "project",
  "chain",
  "symbol",
  "tvlUsd",
  "apy",
  "apyBase",
  "apyReward",
  "stablecoin",
  "ilRisk",
  "exposure",
  "underlyingTokens",
];

const STABLECOIN_FIELDS = [
  "id",
  "name",
  "symbol",
  "pegType",
  "pegMechanism",
  "priceSource",
  "circulating",
  "chains",
];

const OVERVIEW_PROTOCOL_FIELDS = [
  "name",
  "displayName",
  "module",
  "category",
  "chains",
  "total24h",
  "total7d",
  "total30d",
  "totalAllTime",
  "change_1d",
  "change_7d",
  "change_1m",
];

const TOOLS: ToolDef[] = [
  // ---------- TVL ----------
  {
    name: "defillama_protocols",
    description:
      "List all protocols tracked by DeFi Llama with current TVL, chain(s), category, and 1d/7d change. Pass `limit` to cap (default 50, sorted by TVL desc).",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max protocols (default 50, max 500). Sorted by TVL desc.",
        },
      },
    },
    build: () => ({ host: "tvl", path: "/protocols", query: {} }),
    trim: (parsed, args) => {
      if (!Array.isArray(parsed)) return parsed;
      const arr = [...parsed] as Array<Record<string, unknown>>;
      arr.sort((a, b) => Number(b["tvl"] ?? 0) - Number(a["tvl"] ?? 0));
      return project(arr.slice(0, clampLimit(args, 50)), PROTOCOLS_FIELDS);
    },
  },
  {
    name: "defillama_protocol",
    description:
      "Full TVL breakdown + metadata + historical chartTvl for a single protocol by its DeFi Llama slug (e.g. 'aave-v3', 'morpho-blue', 'aerodrome').",
    inputSchema: {
      type: "object",
      required: ["protocol"],
      properties: {
        protocol: {
          type: "string",
          description: "DeFi Llama protocol slug (lowercase, hyphenated).",
        },
      },
    },
    build: (args) => ({
      host: "tvl",
      path: `/protocol/${str(args, "protocol")}`,
      query: {},
    }),
  },
  {
    name: "defillama_chains",
    description:
      "List all chains DeFi Llama tracks with current TVL, token symbol, gecko id, and protocol counts.",
    inputSchema: { type: "object", properties: {} },
    build: () => ({ host: "tvl", path: "/v2/chains", query: {} }),
  },

  // ---------- Prices / coins ----------
  {
    name: "defillama_prices_current",
    description:
      "Current USD prices for one or more coins. Coin keys are `${chain}:${address}` for tokens or `coingecko:${id}` for fiat/CG-tracked assets (e.g. 'ethereum:0x...', 'base:0x...', 'coingecko:ethereum').",
    inputSchema: {
      type: "object",
      required: ["coins"],
      properties: {
        coins: {
          type: "array",
          items: { type: "string" },
          description: "Coin keys, e.g. ['base:0xabc...', 'coingecko:ethereum'].",
        },
        searchWidth: {
          type: "string",
          description: "Time tolerance, e.g. '4h'. Optional.",
        },
      },
    },
    build: (args) => {
      const coins = (args["coins"] as string[]).join(",");
      return {
        host: "coins",
        path: `/prices/current/${coins}`,
        query: pickQuery(args, ["searchWidth"]),
      };
    },
  },
  {
    name: "defillama_prices_chart",
    description:
      "Price time-series chart for one or more coins. Optional `start` (unix s), `end`, `span` (number of data points), `period` (e.g. '2d'), `searchWidth`. Use this for any historical price need.",
    inputSchema: {
      type: "object",
      required: ["coins"],
      properties: {
        coins: { type: "array", items: { type: "string" } },
        start: { type: "number", description: "Unix seconds." },
        end: { type: "number", description: "Unix seconds." },
        span: { type: "number" },
        period: { type: "string", description: "e.g. '2d', '1w'." },
        searchWidth: { type: "string" },
      },
    },
    build: (args) => {
      const coins = (args["coins"] as string[]).join(",");
      return {
        host: "coins",
        path: `/chart/${coins}`,
        query: pickQuery(args, ["start", "end", "span", "period", "searchWidth"]),
      };
    },
  },

  // ---------- Stablecoins ----------
  {
    name: "defillama_stablecoins",
    description:
      "List all stablecoins with circulating supply across chains. Pass `includePrices=true` to include current prices. Pass `limit` (default 50, sorted by circulating desc).",
    inputSchema: {
      type: "object",
      properties: {
        includePrices: { type: "boolean" },
        limit: { type: "number" },
      },
    },
    build: (args) => ({
      host: "stablecoins",
      path: "/stablecoins",
      query: pickQuery(args, ["includePrices"]),
    }),
    trim: (parsed, args) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const obj = parsed as Record<string, unknown>;
      const list = obj["peggedAssets"];
      if (!Array.isArray(list)) return parsed;
      const sorted = [...list] as Array<Record<string, unknown>>;
      sorted.sort((a, b) => {
        const ac = a["circulating"] as Record<string, number> | undefined;
        const bc = b["circulating"] as Record<string, number> | undefined;
        const av = ac ? Number(ac["peggedUSD"] ?? 0) : 0;
        const bv = bc ? Number(bc["peggedUSD"] ?? 0) : 0;
        return bv - av;
      });
      obj["peggedAssets"] = project(
        sorted.slice(0, clampLimit(args, 50)),
        STABLECOIN_FIELDS,
      );
      return obj;
    },
  },

  // ---------- Yields ----------
  {
    name: "defillama_pools",
    description:
      "List all yield pools with APY, TVL, project, chain, and risk metadata. Pass `limit` (default 50, sorted by tvlUsd desc).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
    build: () => ({ host: "yields", path: "/pools", query: {} }),
    trim: (parsed, args) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const obj = parsed as Record<string, unknown>;
      const list = obj["data"];
      if (!Array.isArray(list)) return parsed;
      const sorted = [...list] as Array<Record<string, unknown>>;
      sorted.sort((a, b) => Number(b["tvlUsd"] ?? 0) - Number(a["tvlUsd"] ?? 0));
      obj["data"] = project(
        sorted.slice(0, clampLimit(args, 50)),
        POOLS_FIELDS,
      );
      return obj;
    },
  },
  {
    name: "defillama_pool_chart",
    description:
      "Historical APY + TVL chart for a single yield pool by its DeFi Llama pool id (the `pool` field from defillama_pools).",
    inputSchema: {
      type: "object",
      required: ["pool"],
      properties: {
        pool: { type: "string", description: "Pool id (UUID)." },
      },
    },
    build: (args) => ({
      host: "yields",
      path: `/chart/${str(args, "pool")}`,
      query: {},
    }),
  },

  // ---------- DEX volumes ----------
  {
    name: "defillama_dexs_overview",
    description:
      "Overview of all DEX volumes across all chains. Pass `limit` (default 50, sorted by total24h desc).",
    inputSchema: {
      type: "object",
      properties: {
        excludeTotalDataChart: { type: "boolean" },
        excludeTotalDataChartBreakdown: { type: "boolean" },
        dataType: {
          type: "string",
          description: "Optional: dailyVolume (default), totalVolume, etc.",
        },
        limit: { type: "number" },
      },
    },
    build: (args) => ({
      host: "tvl",
      path: "/overview/dexs",
      query: pickQuery(args, [
        "excludeTotalDataChart",
        "excludeTotalDataChartBreakdown",
        "dataType",
      ]),
    }),
    trim: trimOverview,
  },

  // ---------- Fees / revenue ----------
  {
    name: "defillama_fees_overview",
    description:
      "Overview of protocol fees + revenue across all chains. Use `dataType` to switch between 'dailyFees' (default) and 'dailyRevenue'. Pass `limit` (default 50).",
    inputSchema: {
      type: "object",
      properties: {
        excludeTotalDataChart: { type: "boolean" },
        excludeTotalDataChartBreakdown: { type: "boolean" },
        dataType: {
          type: "string",
          description: "dailyFees | dailyRevenue | totalFees | totalRevenue.",
        },
        limit: { type: "number" },
      },
    },
    build: (args) => ({
      host: "tvl",
      path: "/overview/fees",
      query: pickQuery(args, [
        "excludeTotalDataChart",
        "excludeTotalDataChartBreakdown",
        "dataType",
      ]),
    }),
    trim: trimOverview,
  },
];

// Shared trimmer for /overview/* endpoints — they all share the same shape:
// { totalDataChart, totalDataChartBreakdown, protocols: [...], ... }. We
// drop the heavy chart arrays unless the caller already excluded them, sort
// protocols by total24h desc, project to key fields, and apply `limit`.
function trimOverview(
  parsed: unknown,
  args: Record<string, unknown>,
): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const obj = { ...(parsed as Record<string, unknown>) };
  delete obj["totalDataChart"];
  delete obj["totalDataChartBreakdown"];
  const list = obj["protocols"];
  if (Array.isArray(list)) {
    const sorted = [...list] as Array<Record<string, unknown>>;
    sorted.sort(
      (a, b) => Number(b["total24h"] ?? 0) - Number(a["total24h"] ?? 0),
    );
    obj["protocols"] = project(
      sorted.slice(0, clampLimit(args, 50)),
      OVERVIEW_PROTOCOL_FIELDS,
    );
  }
  return obj;
}

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listDefiLlamaTools(): DefiLlamaTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findDefiLlamaTool(name: string): boolean {
  return toolIndex.has(name);
}

export function defiLlamaStatus(): { connected: boolean; toolCount: number } {
  // Public free endpoints — always considered connected.
  return { connected: true, toolCount: TOOLS.length };
}

function hostBase(host: Host): string {
  switch (host) {
    case "coins":
      return COINS_BASE;
    case "yields":
      return YIELDS_BASE;
    case "stablecoins":
      return STABLECOINS_BASE;
    case "tvl":
    default:
      return TVL_BASE;
  }
}

function buildUrl(req: BuiltRequest): string {
  const url = new URL(`${hostBase(req.host)}${req.path}`);
  for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
  return url.toString();
}

export async function callDefiLlamaTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolIndex.get(name);
  if (!tool) {
    return { isError: true, content: `Unknown DeFi Llama tool: ${name}` };
  }
  let url: string;
  try {
    url = buildUrl(tool.build(args));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: `Failed to build DeFi Llama request: ${message}`,
    };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await resp.text();
    if (!resp.ok) {
      logger.warn(
        { tool: name, status: resp.status, body: text.slice(0, 500) },
        "DeFi Llama API error",
      );
      if (resp.status === 429) {
        return {
          isError: true,
          content:
            "DeFi Llama rate limit hit. Wait a moment and retry; consider narrowing `limit` or caching.",
        };
      }
      return {
        isError: true,
        content: `DeFi Llama ${resp.status}: ${text.slice(0, 1000)}`,
      };
    }
    if (tool.trim) {
      try {
        const parsed = JSON.parse(text);
        const trimmed = tool.trim(parsed, args);
        return { isError: false, content: JSON.stringify(trimmed) };
      } catch {
        return { isError: false, content: text };
      }
    }
    return { isError: false, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, err }, "DeFi Llama fetch failed");
    return { isError: true, content: `DeFi Llama request failed: ${message}` };
  }
}
