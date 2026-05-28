import { Router, type IRouter } from "express";
import { getStatus as getBaseMcpStatus, listTools as listBaseMcpTools } from "../lib/base-mcp";
import { listAnonMcpStatuses, getAnonMcpTools } from "../lib/mcp-anon";
import { listMoralisTools, moralisStatus } from "../lib/moralis";
import { listCmcTools, cmcStatus } from "../lib/cmc";
import { listBankrTools, bankrStatus } from "../lib/bankr";
import { listDefiLlamaTools, defiLlamaStatus } from "../lib/defillama";
import { isProtocolEnabled, setProtocolEnabled } from "../lib/settings";

const router: IRouter = Router();

interface ProtocolStatus {
  id: string;
  label: string;
  kind: string;
  connected: boolean;
  toolCount: number;
  requiresAuth: boolean;
  enabled: boolean;
  source: "mcp" | "api";
  via?: string;
  error?: string;
}

export interface ApiProtocol {
  id: string;
  label: string;
  kind: string;
  via: string;
  description: string;
}

// Plain HTTP-API integrations the agent can hit via web_request. No MCP
// transport, no tools — just documented endpoints.
export const API_PROTOCOLS: ApiProtocol[] = [];

const PROTOCOL_DESCRIPTIONS: Record<string, string> = {
  base: "Base account MCP — your wallet on Base. Provides read access to balances/portfolio and the ability to construct send/swap/sign transactions for approval in Base account.",
  moralis:
    "Moralis Web3 Data API — native bunnyOS implementation. Multi-chain EVM read tools: wallet history, token balances + USD prices, NFTs, DeFi positions, token metadata + holders + prices. Requires a Moralis API key (set in Configure → llm).",
  cmc:
    "CoinMarketCap price + market data — native bunnyOS implementation. REQUIRED: bunnyOS needs a CMC key for token pricing, discovery, and global market context. Coin quotes by symbol/id/slug or contract address (defaults to Base), top market-cap listings, NEWLY LISTED coins (discover fresh tokens within hours), full metadata with trust/risk tags and cmc_rank, id/symbol map, global market snapshot, price conversion, and key/usage status. Free Basic tier (no card required, get one at coinmarketcap.com/api).",
  bankr:
    "Bankr token launches — native bunnyOS implementation. Single tool that returns the most recent (last ~50) token launches tracked by Bankr (https://bankr.bot). Public endpoint, no key required.",
  defillama:
    "DeFi Llama — native bunnyOS implementation against the free public API (api.llama.fi + coins.llama.fi). Covers protocol TVL, chain TVL history, token prices (current/historical/chart), yield pools, stablecoins, DEX volumes, options, open interest, and fees/revenue. Large list endpoints accept `limit` and are trimmed/projected server-side. No API key required.",
};

router.get("/protocols", async (_req, res): Promise<void> => {
  try {
    const base = await getBaseMcpStatus();
    const anon = listAnonMcpStatuses();
    const moralis = moralisStatus();
    const cmc = cmcStatus();
    const bankr = bankrStatus();
    const protocols: ProtocolStatus[] = [
      {
        id: "base",
        label: "base mcp",
        kind: "wallet / swap / send / sign",
        connected: base.connected,
        toolCount: base.toolCount,
        requiresAuth: true,
        enabled: isProtocolEnabled("base"),
        source: "mcp",
      },
      {
        id: "moralis",
        label: "moralis",
        kind: "wallet / token / nft / defi data",
        connected: moralis.connected,
        toolCount: moralis.toolCount,
        requiresAuth: true,
        enabled: isProtocolEnabled("moralis"),
        source: "api" as const,
        via: "native",
      },
      {
        id: "cmc",
        label: "coinmarketcap",
        kind: "prices / markets / new listings",
        connected: cmc.connected,
        toolCount: cmc.toolCount,
        requiresAuth: true,
        enabled: isProtocolEnabled("cmc"),
        source: "api" as const,
        via: "native",
      },
      {
        id: "defillama",
        label: "defillama",
        kind: "tvl / yields / dex / fees / stablecoins",
        connected: defiLlamaStatus().connected,
        toolCount: defiLlamaStatus().toolCount,
        requiresAuth: false,
        enabled: isProtocolEnabled("defillama"),
        source: "api" as const,
        via: "native",
      },
      {
        id: "bankr",
        label: "bankr",
        kind: "token launches",
        connected: bankr.connected,
        toolCount: bankr.toolCount,
        requiresAuth: false,
        enabled: isProtocolEnabled("bankr"),
        source: "api" as const,
        via: "native",
      },
      ...anon.map((a) => ({
        id: a.id,
        label: a.label,
        kind: a.kind,
        connected: a.connected,
        toolCount: a.toolCount,
        requiresAuth: false,
        enabled: isProtocolEnabled(a.id),
        source: "mcp" as const,
        ...(a.error ? { error: a.error } : {}),
      })),
      ...API_PROTOCOLS.map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        connected: true, // HTTP APIs are assumed reachable
        toolCount: 0,
        requiresAuth: false,
        enabled: isProtocolEnabled(p.id),
        source: "api" as const,
        via: p.via,
      })),
    ];
    res.json({ protocols });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/protocols/:id/tools", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }
  try {
    if (id === "base") {
      const tools = await listBaseMcpTools();
      res.json({
        id,
        label: "base mcp",
        kind: "wallet / swap / send / sign",
        source: "mcp",
        description: PROTOCOL_DESCRIPTIONS["base"] ?? "",
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      return;
    }
    if (id === "moralis") {
      const tools = listMoralisTools();
      res.json({
        id,
        label: "moralis",
        kind: "wallet / token / nft / defi data",
        source: "api",
        via: "native",
        description: PROTOCOL_DESCRIPTIONS["moralis"] ?? "",
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      return;
    }
    if (id === "cmc") {
      const tools = listCmcTools();
      res.json({
        id,
        label: "coinmarketcap",
        kind: "prices / markets / new listings",
        source: "api",
        via: "native",
        description: PROTOCOL_DESCRIPTIONS["cmc"] ?? "",
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      return;
    }
    if (id === "defillama") {
      const tools = listDefiLlamaTools();
      res.json({
        id,
        label: "defillama",
        kind: "tvl / yields / dex / fees / stablecoins",
        source: "api",
        via: "native",
        description: PROTOCOL_DESCRIPTIONS["defillama"] ?? "",
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      return;
    }
    if (id === "bankr") {
      const tools = listBankrTools();
      res.json({
        id,
        label: "bankr",
        kind: "token launches",
        source: "api",
        via: "native",
        description: PROTOCOL_DESCRIPTIONS["bankr"] ?? "",
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      return;
    }
    const anonStatus = listAnonMcpStatuses().find((a) => a.id === id);
    if (anonStatus) {
      const tools = getAnonMcpTools(id) ?? [];
      res.json({
        id,
        label: anonStatus.label,
        kind: anonStatus.kind,
        source: "mcp",
        description: `${anonStatus.label} MCP server — ${anonStatus.kind}.`,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      return;
    }
    const api = API_PROTOCOLS.find((p) => p.id === id);
    if (api) {
      res.json({
        id,
        label: api.label,
        kind: api.kind,
        source: "api",
        via: api.via,
        description: api.description,
        tools: [],
      });
      return;
    }
    res.status(404).json({ error: "unknown protocol" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/protocols/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  const body = req.body as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be boolean" });
    return;
  }
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }
  await setProtocolEnabled(id, body.enabled);
  res.json({ id, enabled: body.enabled });
});

export default router;
