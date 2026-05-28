import { getMoralisApiKey } from "./settings";
import { logger } from "./logger";

const BASE_URL = "https://deep-index.moralis.io/api/v2.2";
const DEFAULT_CHAIN = "base";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  build: (args: Record<string, unknown>) => { path: string; query: Record<string, string | string[]> };
}

function addressSchema(extra: Record<string, unknown> = {}) {
  return {
    type: "object",
    required: ["address"],
    properties: {
      address: {
        type: "string",
        description: "EVM wallet or token contract address (0x-prefixed)",
      },
      chain: {
        type: "string",
        description:
          "Chain slug or hex chain id. Defaults to 'base'. Examples: base, eth, polygon, arbitrum, optimism, bsc, avalanche.",
      },
      ...extra,
    },
  } as Record<string, unknown>;
}

const limitProp = {
  limit: {
    type: "number",
    description: "Max items to return (default 25, max 100).",
  },
  cursor: { type: "string", description: "Pagination cursor from a previous response." },
};

const TOOLS: ToolDef[] = [
  {
    name: "moralis_wallet_history",
    description:
      "Get a wallet's full normalized transaction history (sends, receives, swaps, approvals, NFT transfers) on a given chain.",
    inputSchema: addressSchema({
      ...limitProp,
      from_date: { type: "string", description: "ISO date (lower bound)." },
      to_date: { type: "string", description: "ISO date (upper bound)." },
    }),
    build: (args) => ({
      path: `/wallets/${args["address"]}/history`,
      query: pick(args, ["chain", "limit", "cursor", "from_date", "to_date"]),
    }),
  },
  {
    name: "moralis_wallet_tokens",
    description:
      "Get a wallet's ERC20 token balances with USD prices and 24h price change on a given chain.",
    inputSchema: addressSchema(),
    build: (args) => ({
      path: `/wallets/${args["address"]}/tokens`,
      query: pick(args, ["chain"]),
    }),
  },
  {
    name: "moralis_wallet_native_balance",
    description:
      "Get a wallet's native token balance (ETH, MATIC, etc.) on a given chain.",
    inputSchema: addressSchema(),
    build: (args) => ({
      path: `/${args["address"]}/balance`,
      query: pick(args, ["chain"]),
    }),
  },
  {
    name: "moralis_wallet_nfts",
    description: "Get the NFTs held by a wallet on a given chain.",
    inputSchema: addressSchema(limitProp),
    build: (args) => ({
      path: `/${args["address"]}/nft`,
      query: { ...pick(args, ["chain", "limit", "cursor"]), format: "decimal" },
    }),
  },
  {
    name: "moralis_wallet_defi_positions",
    description:
      "Get a wallet's DeFi positions (LPs, lending, staking, etc.) on a given chain.",
    inputSchema: addressSchema(),
    build: (args) => ({
      path: `/wallets/${args["address"]}/defi/positions`,
      query: pick(args, ["chain"]),
    }),
  },
  {
    name: "moralis_wallet_defi_summary",
    description:
      "Get a high-level summary of a wallet's DeFi positions (total value, protocols, position counts) on a given chain.",
    inputSchema: addressSchema(),
    build: (args) => ({
      path: `/wallets/${args["address"]}/defi/summary`,
      query: pick(args, ["chain"]),
    }),
  },
  {
    name: "moralis_wallet_profitability",
    description:
      "Get a wallet's PnL / profitability summary across tokens on a given chain.",
    inputSchema: addressSchema(),
    build: (args) => ({
      path: `/wallets/${args["address"]}/profitability/summary`,
      query: pick(args, ["chain"]),
    }),
  },
  {
    name: "moralis_token_metadata",
    description:
      "Get ERC20 token metadata (name, symbol, decimals, logo, security info) for one or more token contracts on a chain.",
    inputSchema: {
      type: "object",
      required: ["addresses"],
      properties: {
        addresses: {
          type: "array",
          items: { type: "string" },
          description: "Array of ERC20 contract addresses (0x-prefixed).",
        },
        chain: { type: "string", description: "Chain slug. Defaults to 'base'." },
      },
    },
    build: (args) => ({
      path: `/erc20/metadata`,
      query: {
        ...pick(args, ["chain"]),
        addresses: (args["addresses"] as string[]) ?? [],
      },
    }),
  },
  {
    name: "moralis_token_holders",
    description: "Get the top holders for an ERC20 token on a given chain.",
    inputSchema: addressSchema(limitProp),
    build: (args) => ({
      path: `/erc20/${args["address"]}/owners`,
      query: pick(args, ["chain", "limit", "cursor"]),
    }),
  },
  {
    name: "moralis_trending_tokens",
    description:
      "Get trending tokens on a given chain — ranked by Moralis' internal trading-activity score (volume + liquidity + transactions + buy/sell momentum). Defaults to chain='base'. Each item includes tokenAddress, symbol, name, usdPrice, marketCap, liquidityUsd, holders, createdAt (unix seconds), pricePercentChange (1h/4h/12h/24h) and totalVolume (1h/4h/12h/24h). Use this to discover tokens with real on-chain traction; filter the response client-side by createdAt to focus on newly launched ones, and by liquidityUsd / totalVolume.24h to ignore empty pairings. Note: Moralis only accepts `chain` and `limit` as query params on this endpoint — all other filtering must be done on the returned JSON.",
    inputSchema: {
      type: "object",
      properties: {
        chain: {
          type: "string",
          description:
            "Chain slug. Defaults to 'base'. Examples: base, eth, polygon, arbitrum, optimism, bsc, avalanche, solana.",
        },
        limit: {
          type: "number",
          description: "Max items to return.",
        },
      },
    },
    build: (args) => ({
      path: `/tokens/trending`,
      query: pick(args, ["chain", "limit"]),
    }),
  },
  {
    name: "moralis_token_price",
    description:
      "Get the current USD price of an ERC20 token on a given chain.",
    inputSchema: addressSchema(),
    build: (args) => ({
      path: `/erc20/${args["address"]}/price`,
      query: pick(args, ["chain"]),
    }),
  },
];

function pick(
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

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listMoralisTools(): McpTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findMoralisTool(name: string): boolean {
  return toolIndex.has(name);
}

export function moralisStatus(): { connected: boolean; toolCount: number } {
  return {
    connected: Boolean(getMoralisApiKey()),
    toolCount: TOOLS.length,
  };
}

function buildUrl(
  path: string,
  query: Record<string, string | string[]>,
): string {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, v);
    }
  }
  if (!url.searchParams.get("chain")) {
    url.searchParams.set("chain", DEFAULT_CHAIN);
  }
  return url.toString();
}

export async function callMoralisTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolIndex.get(name);
  if (!tool) {
    return { isError: true, content: `Unknown Moralis tool: ${name}` };
  }
  const apiKey = getMoralisApiKey();
  if (!apiKey) {
    return {
      isError: true,
      content:
        "Moralis API key is not configured. Set one in Configure → llm tab, or set MORALIS_API_KEY env var.",
    };
  }
  let url: string;
  try {
    const { path, query } = tool.build(args);
    url = buildUrl(path, query);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: `Failed to build Moralis request: ${message}` };
  }
  try {
    const resp = await fetch(url, {
      headers: { "X-API-Key": apiKey, accept: "application/json" },
    });
    const text = await resp.text();
    if (!resp.ok) {
      logger.warn(
        { tool: name, status: resp.status, body: text.slice(0, 500) },
        "Moralis API error",
      );
      return {
        isError: true,
        content: `Moralis ${resp.status}: ${text.slice(0, 1000)}`,
      };
    }
    return { isError: false, content: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, err }, "Moralis fetch failed");
    return { isError: true, content: `Moralis request failed: ${message}` };
  }
}
