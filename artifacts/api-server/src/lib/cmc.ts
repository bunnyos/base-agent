import { logger } from "./logger";
import { getCmcApiKey } from "./settings";

// CoinMarketCap Pro API. Free "Basic" tier (no card required) covers
// everything below. All endpoints require an API key — there is no
// anonymous tier. Header: `X-CMC_PRO_API_KEY`.
//
// Docs: https://coinmarketcap.com/api/documentation/v1/
const BASE = "https://pro-api.coinmarketcap.com";

export interface CmcTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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

// Sentinel path used for tools that need multi-request orchestration.
// Their `build()` returns this and `callCmcTool` handles them specially.
const COMPOSITE = "__composite__";

const TOOLS: ToolDef[] = [
  {
    name: "cmc_quotes_latest",
    description:
      "Latest market quote for one or more cryptocurrencies, identified by ticker symbol(s), CMC id(s), or slug(s). Returns price, percent_change_1h/24h/7d/30d/60d/90d, market_cap, volume_24h, circulating/total/max supply, cmc_rank, and last_updated. Use cmc_map first if you only have a name and aren't sure of the symbol.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "array",
          items: { type: "string" },
          description: "Ticker symbols (case-insensitive), e.g. ['ETH','BTC','AERO'].",
        },
        id: {
          type: "array",
          items: { type: "string" },
          description: "CMC numeric ids (strings), e.g. ['1027','1'].",
        },
        slug: {
          type: "array",
          items: { type: "string" },
          description: "CMC slugs, e.g. ['ethereum','bitcoin'].",
        },
        convert: {
          type: "string",
          description: "Quote currency or comma-separated list. Default 'USD'.",
        },
      },
    },
    build: (args) => ({
      path: "/v2/cryptocurrency/quotes/latest",
      query: {
        ...pick(args, ["symbol", "id", "slug"]),
        convert: (args["convert"] as string) || "USD",
      },
    }),
  },
  {
    name: "cmc_quotes_by_address",
    description:
      "Latest USD quote for an on-chain ERC20 token by contract address. Defaults to the Base chain (CMC platform). Returns the same fields as cmc_quotes_latest plus the resolved CMC id and platform. Internally resolves address → CMC id → quote in one call.",
    inputSchema: {
      type: "object",
      required: ["address"],
      properties: {
        address: {
          type: "string",
          description: "ERC20 contract address (0x-prefixed).",
        },
        convert: {
          type: "string",
          description: "Quote currency. Default 'USD'.",
        },
      },
    },
    build: () => ({ path: COMPOSITE, query: {} }),
  },
  {
    name: "cmc_listings_latest",
    description:
      "Top cryptocurrencies ranked by market cap (or other sorts) with price, percent change, volume, supply, and cmc_rank. Supports pagination (start/limit), sort, filter by cryptocurrency_type, and tag (e.g. 'base-ecosystem', 'memes', 'defi').",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "number", description: "1-based offset. Default 1." },
        limit: {
          type: "number",
          description: "1-5000. Default 100.",
        },
        sort: {
          type: "string",
          description:
            "One of: market_cap, name, symbol, date_added, market_cap_strict, price, circulating_supply, total_supply, max_supply, num_market_pairs, volume_24h, percent_change_1h, percent_change_24h, percent_change_7d, volume_7d, volume_30d. Default 'market_cap'.",
        },
        sort_dir: {
          type: "string",
          description: "'asc' or 'desc'. Default 'desc'.",
        },
        convert: { type: "string", description: "Quote currency. Default 'USD'." },
        cryptocurrency_type: {
          type: "string",
          description: "'all', 'coins', or 'tokens'.",
        },
        tag: {
          type: "string",
          description:
            "Tag slug to filter by, e.g. 'base-ecosystem', 'memes', 'defi', 'stablecoin'.",
        },
      },
    },
    build: (args) => ({
      path: "/v1/cryptocurrency/listings/latest",
      query: {
        start: String(args["start"] ?? 1),
        limit: String(args["limit"] ?? 100),
        sort: (args["sort"] as string) || "market_cap",
        sort_dir: (args["sort_dir"] as string) || "desc",
        convert: (args["convert"] as string) || "USD",
        ...pick(args, ["cryptocurrency_type", "tag"]),
      },
    }),
  },
  {
    name: "cmc_info",
    description:
      "Full metadata for one or more cryptocurrencies, identified by symbol, id, slug, OR on-chain contract address. Returns description, urls (website/twitter/github/explorer/etc.), logo, tags (includes risk/trust flags like 'scam', 'risky', 'pos', 'audited'), category, contract_addresses across chains, date_added, date_launched, and the platform the token lives on.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "array", items: { type: "string" } },
        id: { type: "array", items: { type: "string" } },
        slug: { type: "array", items: { type: "string" } },
        address: {
          type: "string",
          description:
            "Single on-chain contract address (0x-prefixed). Use this to identify a token by its EVM address (cross-chain, includes Base).",
        },
        aux: {
          type: "string",
          description:
            "Comma-separated extra fields. Default 'urls,logo,description,tags,tag-names,tag-groups,platform,date_added,date_launched,notice,status'.",
        },
      },
    },
    build: (args) => ({
      path: "/v2/cryptocurrency/info",
      query: {
        ...pick(args, ["symbol", "id", "slug", "address"]),
        aux:
          (args["aux"] as string) ||
          "urls,logo,description,tags,tag-names,tag-groups,platform,date_added,date_launched,notice,status",
      },
    }),
  },
  {
    name: "cmc_key_status",
    description:
      "CoinMarketCap API key health: plan tier, credit limits (minute/daily/monthly), credits used so far this period, credits left, and timestamps of the active periods. Use this when the user asks 'am I close to the CMC rate limit' or to decide whether a credit-heavy action (large listings page, many quotes) is safe to run.",
    inputSchema: { type: "object", properties: {} },
    build: () => ({ path: "/v1/key/info", query: {} }),
  },
  {
    name: "cmc_map",
    description:
      "CMC id ↔ symbol ↔ slug map. Use this to resolve a ticker (e.g. 'AERO') to its CMC numeric id before calling other tools, or to discover the canonical id for a name.",
    inputSchema: {
      type: "object",
      properties: {
        listing_status: {
          type: "string",
          description: "'active', 'inactive', or 'untracked'. Default 'active'.",
        },
        start: { type: "number", description: "1-based offset. Default 1." },
        limit: { type: "number", description: "1-5000. Default 100." },
        symbol: {
          type: "array",
          items: { type: "string" },
          description: "Specific symbols to look up (more precise than start/limit).",
        },
      },
    },
    build: (args) => ({
      path: "/v1/cryptocurrency/map",
      query: {
        listing_status: (args["listing_status"] as string) || "active",
        start: String(args["start"] ?? 1),
        limit: String(args["limit"] ?? 100),
        ...pick(args, ["symbol"]),
      },
    }),
  },
  {
    name: "cmc_global_metrics",
    description:
      "Global crypto market snapshot: total market cap, total 24h volume, BTC/ETH dominance, DeFi market cap, stablecoin market cap, active cryptocurrencies, active exchanges, active market pairs.",
    inputSchema: {
      type: "object",
      properties: {
        convert: { type: "string", description: "Quote currency. Default 'USD'." },
      },
    },
    build: (args) => ({
      path: "/v1/global-metrics/quotes/latest",
      query: { convert: (args["convert"] as string) || "USD" },
    }),
  },
  {
    name: "cmc_price_conversion",
    description:
      "Convert an amount of one cryptocurrency or fiat to another using the latest market price. Identify source by symbol OR id. Convert target can be a comma-separated list (e.g. 'USD,EUR,BTC').",
    inputSchema: {
      type: "object",
      required: ["amount"],
      properties: {
        amount: { type: "number", description: "Amount of source to convert." },
        symbol: { type: "string", description: "Source symbol, e.g. 'ETH'." },
        id: { type: "string", description: "Source CMC id (alternative to symbol)." },
        convert: {
          type: "string",
          description: "Target symbol(s), comma-separated. Default 'USD'.",
        },
      },
    },
    build: (args) => ({
      path: "/v2/tools/price-conversion",
      query: {
        amount: String(args["amount"]),
        convert: (args["convert"] as string) || "USD",
        ...pick(args, ["symbol", "id"]),
      },
    }),
  },
];

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listCmcTools(): CmcTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findCmcTool(name: string): boolean {
  return toolIndex.has(name);
}

export function cmcStatus(): {
  connected: boolean;
  toolCount: number;
} {
  return {
    connected: Boolean(getCmcApiKey()),
    toolCount: TOOLS.length,
  };
}

function buildUrl(
  path: string,
  query: Record<string, string | string[]>,
): string {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function rawFetch(
  apiKey: string,
  path: string,
  query: Record<string, string | string[]>,
  toolName: string,
): Promise<{ content: string; isError: boolean }> {
  const url = buildUrl(path, query);
  // Defensive: legacy keys cached before save-time sanitization could
  // still contain a smart quote or NBSP. Fetch headers must be ASCII;
  // a non-ASCII byte here would throw "Cannot convert argument to a
  // ByteString" deep inside fetch. Trip on it explicitly instead.
  if (/[^\x20-\x7E]/.test(apiKey)) {
    return {
      isError: true,
      content:
        "Your saved CoinMarketCap key contains a non-ASCII character (likely a smart quote from paste). Open Configure → llm → coinmarketcap api key, delete it, and paste a fresh copy.",
    };
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "X-CMC_PRO_API_KEY": apiKey,
  };
  try {
    const resp = await fetch(url, { headers });
    const text = await resp.text();
    if (!resp.ok) {
      logger.warn(
        { tool: toolName, status: resp.status, body: text.slice(0, 500) },
        "CoinMarketCap API error",
      );
      if (resp.status === 401 || resp.status === 403) {
        return {
          isError: true,
          content:
            "CoinMarketCap rejected the API key (401/403). Either the key is invalid (check CMC_API_KEY or Configure → llm) or this endpoint requires a paid tier — the free Basic plan does NOT cover /listings/new, /listings/historical, /quotes/historical, /ohlcv/*, /trending/*, or /categories.",
        };
      }
      if (resp.status === 429) {
        return {
          isError: true,
          content:
            "CoinMarketCap rate limit hit (Basic tier: 30 req/min, 10k/month). Wait a minute and retry, or batch ids into a single call (cmc_quotes_latest accepts arrays).",
        };
      }
      if (resp.status === 402) {
        return {
          isError: true,
          content: `CoinMarketCap 402: this endpoint requires a paid tier. Free Basic tier covers cmc_quotes_latest, cmc_quotes_by_address, cmc_listings_latest, cmc_info, cmc_map, cmc_global_metrics, cmc_price_conversion. Body: ${text.slice(0, 400)}`,
        };
      }
      return {
        isError: true,
        content: `CoinMarketCap ${resp.status}: ${text.slice(0, 1000)}`,
      };
    }
    return { isError: false, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: toolName, err }, "CoinMarketCap fetch failed");
    return { isError: true, content: `CoinMarketCap request failed: ${message}` };
  }
}

// Composite handler: address → info → id → quotes_latest. Stitched into
// one tool because the agent shouldn't have to chain two calls just to
// price a token it already has the contract for.
async function quotesByAddress(
  apiKey: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const address = String(args["address"] ?? "").trim();
  if (!address) {
    return { isError: true, content: "address is required" };
  }
  const convert = (args["convert"] as string) || "USD";
  const info = await rawFetch(
    apiKey,
    "/v2/cryptocurrency/info",
    { address, aux: "platform,status" },
    "cmc_quotes_by_address(info)",
  );
  if (info.isError) return info;
  let cmcId: string | null = null;
  let platform: unknown = null;
  try {
    const parsed = JSON.parse(info.content) as {
      data?: Record<string, { id?: number; platform?: unknown }>;
    };
    const data = parsed.data ?? {};
    const first = Object.values(data)[0];
    if (first?.id) cmcId = String(first.id);
    if (first?.platform) platform = first.platform;
  } catch {
    /* fall through */
  }
  if (!cmcId) {
    return {
      isError: true,
      content: `CMC has no listing for address ${address}. The token may be too new or not yet tracked. Try DeFi Llama or Moralis for on-chain prices.`,
    };
  }
  const quote = await rawFetch(
    apiKey,
    "/v2/cryptocurrency/quotes/latest",
    { id: cmcId, convert },
    "cmc_quotes_by_address(quote)",
  );
  if (quote.isError) return quote;
  // Wrap the quote response with the resolved id/platform so the agent
  // can see what got matched without a second info call.
  try {
    const parsed = JSON.parse(quote.content) as Record<string, unknown>;
    const enriched = {
      resolved: { address, cmc_id: cmcId, platform },
      ...parsed,
    };
    return { isError: false, content: JSON.stringify(enriched) };
  } catch {
    return quote;
  }
}

export async function callCmcTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolIndex.get(name);
  if (!tool) {
    return { isError: true, content: `Unknown CoinMarketCap tool: ${name}` };
  }
  const apiKey = getCmcApiKey();
  if (!apiKey) {
    return {
      isError: true,
      content:
        "CoinMarketCap is not configured. Add a free Basic-tier key (no card required) at https://coinmarketcap.com/api/ and paste it into Configure → llm → coinmarketcap api key.",
    };
  }
  if (name === "cmc_quotes_by_address") {
    return quotesByAddress(apiKey, args);
  }
  let path: string;
  let query: Record<string, string | string[]>;
  try {
    ({ path, query } = tool.build(args));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: `Failed to build CoinMarketCap request: ${message}`,
    };
  }
  return rawFetch(apiKey, path, query, name);
}
