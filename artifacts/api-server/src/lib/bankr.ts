import { logger } from "./logger";

const BANKR_BASE = "https://api.bankr.bot";

export interface BankrTool {
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
    query: Record<string, string>;
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "bankr_recent_token_launches",
    description:
      "Get the most recent token launches tracked by Bankr (https://bankr.bot). Returns the list of the latest launches with whatever metadata Bankr exposes (token name, symbol, contract address, chain, creator, launch time, etc.). Use this to discover newly launched tokens, surface trending launches, or answer questions like 'what just launched on Base / Solana / etc.'. No API key required.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    build: () => ({
      path: "/token-launches",
      query: {},
    }),
  },
];

const toolIndex = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t]));

export function listBankrTools(): BankrTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export function findBankrTool(name: string): boolean {
  return toolIndex.has(name);
}

export function bankrStatus(): { connected: boolean; toolCount: number } {
  // Public endpoint, no key required — always considered connected.
  return { connected: true, toolCount: TOOLS.length };
}

function buildUrl(path: string, query: Record<string, string>): string {
  const url = new URL(`${BANKR_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

// Bankr returns launches newest-first (currently ~50). Cap defensively in
// case that ever changes so the model isn't drowned in tokens. slice(0, N)
// keeps the most-recent N because of the newest-first ordering.
const MAX_LAUNCHES = 50;

function trimToLast50(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (Array.isArray(parsed)) {
    return JSON.stringify(parsed.slice(0, MAX_LAUNCHES));
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["data", "launches", "results", "items"]) {
      const v = obj[key];
      if (Array.isArray(v)) {
        obj[key] = v.slice(0, MAX_LAUNCHES);
        return JSON.stringify(obj);
      }
    }
  }
  return raw;
}

export async function callBankrTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const tool = toolIndex.get(name);
  if (!tool) {
    return { isError: true, content: `Unknown Bankr tool: ${name}` };
  }
  let url: string;
  try {
    const { path, query } = tool.build(args);
    url = buildUrl(path, query);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: `Failed to build Bankr request: ${message}`,
    };
  }
  try {
    const resp = await fetch(url, { headers: { accept: "application/json" } });
    const text = await resp.text();
    if (!resp.ok) {
      logger.warn(
        { tool: name, status: resp.status, body: text.slice(0, 500) },
        "Bankr API error",
      );
      return {
        isError: true,
        content: `Bankr ${resp.status}: ${text.slice(0, 1000)}`,
      };
    }
    return { isError: false, content: trimToLast50(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, err }, "Bankr fetch failed");
    return { isError: true, content: `Bankr request failed: ${message}` };
  }
}
