import { logger } from "./logger";
import {
  getCoinGeckoTokenOnchain,
  getCoinGeckoPoolData,
  coinGeckoStatus,
  type CoinGeckoMarketData,
} from "./coingecko";
import { getTokenSecuritySafe, type TokenSecurity } from "./goplus";

// bunnyOS native tools — the "call our own functions" set.
//
// Unlike the other tool libs (moralis/coingecko/defillama/bankr), these are NOT
// thin wrappers around a single upstream endpoint. They are higher-level
// COMPOSED functions implemented by bunnyOS that fan out to the existing data
// sources and merge the results into one answer, so the agent gets a complete
// picture from a single tool call instead of orchestrating three.
//
// Market data still comes exclusively from the CoinGecko demo API (per the
// project-wide mandate); contract-security data comes from GoPlus (enrichment
// only). No new external data hosts are introduced here.
//
// Protocol id is "native"; gated by isProtocolEnabled("native") and toggleable
// from the Configure → protocols screen like every other tool set.

export interface NativeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type ToolRunner = (
  args: Record<string, unknown>,
) => Promise<{ content: string; isError: boolean }>;

const DEFAULT_NETWORK = "base";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function reqAddress(args: Record<string, unknown>): string {
  const raw = args["address"];
  const addr = typeof raw === "string" ? raw.trim() : "";
  if (!addr) throw new Error("missing required arg: address");
  if (!ADDRESS_RE.test(addr)) {
    throw new Error(
      `invalid token address: ${addr} (expected a 0x-prefixed 40-hex EVM contract address)`,
    );
  }
  return addr;
}

function optNetwork(args: Record<string, unknown>): string {
  const raw = args["network"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_NETWORK;
}

// Compose a full research snapshot for a single token contract: onchain market
// data (price / liquidity / market cap / volume / momentum from CoinGecko) plus
// the GoPlus contract-security profile (honeypot, taxes, ownership, holder
// concentration). Each source degrades independently — a missing CoinGecko key
// or an unindexed token still returns whatever the other source has, with a
// note explaining the gap, rather than failing the whole call.
async function researchToken(
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const address = reqAddress(args);
  const network = optNetwork(args);
  const key = address.toLowerCase();
  const notes: string[] = [];

  let market:
    | (CoinGeckoMarketData & {
        topPool: string | null;
        volume24hAggregate: number | null;
      })
    | null = null;

  try {
    const onchain = await getCoinGeckoTokenOnchain([key], network);
    const info = onchain.get(key);
    if (info?.pool) {
      const pd = await getCoinGeckoPoolData([info.pool], network);
      const md = pd.data.get(info.pool.toLowerCase());
      if (md) {
        market = {
          ...md,
          topPool: info.pool,
          volume24hAggregate: info.volume24h,
        };
      }
    }
    if (!market) {
      if (!coinGeckoStatus().connected) {
        notes.push(
          "no onchain market data: CoinGecko demo key not configured (set it in Configure → llm).",
        );
      } else {
        notes.push(
          "no onchain market data: CoinGecko has not indexed a pool for this token on this network.",
        );
      }
    }
  } catch (err) {
    logger.warn({ err, address: key }, "native research: market lookup failed");
    notes.push("onchain market lookup failed (transient upstream error).");
  }

  let security: TokenSecurity | null = null;
  if (network === DEFAULT_NETWORK) {
    try {
      security = await getTokenSecuritySafe(key);
      if (!security) {
        notes.push(
          "no contract-security data: GoPlus has no record for this token (very new or unindexed).",
        );
      }
    } catch (err) {
      logger.warn(
        { err, address: key },
        "native research: security lookup failed",
      );
      notes.push("contract-security lookup failed (transient upstream error).");
    }
  } else {
    // GoPlus security here is Base-only (chain 8453). Skip it on other
    // networks rather than pairing Base security with non-Base market data for
    // the same hex address, which would be misleading.
    notes.push(
      `contract-security skipped: only available on base, requested network was '${network}'.`,
    );
  }

  const payload = {
    address: key,
    network,
    market,
    security,
    notes,
  };
  return { isError: false, content: JSON.stringify(payload) };
}

const TOOLS: ToolDef[] = [
  {
    name: "research_token",
    description:
      "Research a single token by its contract address on Base. Composes onchain market data (USD price, liquidity, market cap, 1h/24h price change, 24h volume, top pool address — all from CoinGecko) with the token's contract-security profile (honeypot, buy/sell tax, open-source, mintable, ownership reclaim, hidden owner, blacklist, owner/top-holder concentration, holder count — from GoPlus) into one call. Use this as the first stop when the user asks you to research / vet / due-diligence a token address. Returns partial data with a `notes` array if a source has nothing for the token.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            "The token contract address (CA), 0x-prefixed 40-hex EVM address.",
        },
        network: {
          type: "string",
          description:
            "Network slug. Optional, defaults to 'base'. Contract-security data is Base-only and is skipped (with a note) on other networks.",
        },
      },
      required: ["address"],
    },
  },
];

const RUNNERS = new Map<string, ToolRunner>([
  ["research_token", researchToken],
]);

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listNativeTools(): NativeTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findNativeTool(name: string): boolean {
  return toolIndex.has(name);
}

// Native composed tools have no key/connection of their own — they are always
// "connected". They depend on CoinGecko/GoPlus at call time and degrade
// gracefully when those are unavailable.
export function nativeToolsStatus(): { connected: boolean; toolCount: number } {
  return { connected: true, toolCount: TOOLS.length };
}

export async function callNativeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const run = RUNNERS.get(name);
  if (!run) {
    return { isError: true, content: `Unknown native tool: ${name}` };
  }
  try {
    return await run(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: `native tool ${name} failed: ${message}` };
  }
}
