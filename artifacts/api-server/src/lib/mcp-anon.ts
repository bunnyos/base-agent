import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "./logger";

export interface AnonMcpConfig {
  id: string;
  label: string;
  url: string;
  kind: string;
}

export interface AnonMcpStatus {
  id: string;
  label: string;
  kind: string;
  connected: boolean;
  toolCount: number;
  error?: string;
}

interface AnonMcpEntry {
  config: AnonMcpConfig;
  client: Client | null;
  transport: StreamableHTTPClientTransport | null;
  tools: McpTool[];
  lastError: string | null;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const registry = new Map<string, AnonMcpEntry>();

export function registerAnonMcp(config: AnonMcpConfig): void {
  if (registry.has(config.id)) return;
  registry.set(config.id, {
    config,
    client: null,
    transport: null,
    tools: [],
    lastError: null,
  });
}

async function connect(entry: AnonMcpEntry): Promise<void> {
  if (entry.client) return;
  const transport = new StreamableHTTPClientTransport(new URL(entry.config.url));
  const client = new Client(
    { name: "bunny-defi-companion", version: "0.1.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  entry.client = client;
  entry.transport = transport;
  const listed = await client.listTools();
  entry.tools = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
  }));
  entry.lastError = null;
  logger.info(
    { id: entry.config.id, toolCount: entry.tools.length },
    "Anon MCP connected",
  );
}

async function connectAnonMcp(id: string): Promise<void> {
  const entry = registry.get(id);
  if (!entry) throw new Error(`Unknown anon MCP: ${id}`);
  try {
    await connect(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    entry.lastError = message;
    logger.warn({ id, err }, "Anon MCP connect failed");
  }
}

export async function connectAllAnonMcps(): Promise<void> {
  await Promise.all(
    Array.from(registry.keys()).map((id) => connectAnonMcp(id)),
  );
}

export function listAnonMcpStatuses(): AnonMcpStatus[] {
  return Array.from(registry.values()).map((e) => ({
    id: e.config.id,
    label: e.config.label,
    kind: e.config.kind,
    connected: e.client !== null,
    toolCount: e.tools.length,
    ...(e.lastError ? { error: e.lastError } : {}),
  }));
}

export function getAnonMcpTools(id: string): McpTool[] | null {
  const entry = registry.get(id);
  if (!entry) return null;
  return entry.tools;
}

export function listAllAnonMcpTools(): Array<McpTool & { serverId: string }> {
  const all: Array<McpTool & { serverId: string }> = [];
  for (const entry of registry.values()) {
    if (!entry.client) continue;
    for (const t of entry.tools) {
      all.push({ ...t, serverId: entry.config.id });
    }
  }
  return all;
}

export function findAnonMcpForTool(toolName: string): string | null {
  for (const entry of registry.values()) {
    if (!entry.client) continue;
    if (entry.tools.some((t) => t.name === toolName)) return entry.config.id;
  }
  return null;
}

export async function callAnonMcpTool(
  serverId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const entry = registry.get(serverId);
  if (!entry || !entry.client) {
    throw new Error(`Anon MCP ${serverId} is not connected`);
  }
  const res = await entry.client.callTool({ name, arguments: args });
  const isError = Boolean(res.isError);
  const text = Array.isArray(res.content)
    ? res.content
        .map((c) => {
          if (typeof c === "object" && c && "type" in c && c.type === "text" && "text" in c) {
            return String((c as { text: unknown }).text);
          }
          return JSON.stringify(c);
        })
        .join("\n")
    : JSON.stringify(res.content ?? res);
  return { content: text, isError };
}
