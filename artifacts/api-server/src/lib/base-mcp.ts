import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { logger } from "./logger";
import { getBaseMcpSession, setBaseMcpSession } from "./settings";
import { getCurrentUserId } from "./user";
import { getActiveRequestOrigin } from "./request-context";

const MCP_SERVER_URL = "https://mcp.base.org";

interface StoredState {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  oauthState?: string;
}

// In-memory OAuth state for anonymous visitors who are mid-flow. We can't
// persist to user_settings because there's no user row yet — the wallet
// address (and therefore the userId) is only known *after* the OAuth callback
// completes. Once the callback finishes we migrate the entry into the real
// user's DB-backed settings via migrateAnonOAuthToUser.
const ANON_PREFIX = "anon:";
const anonStates = new Map<string, StoredState>();
const anonCreatedAt = new Map<string, number>();
// Anon entries are only useful until the user finishes (or abandons) the
// OAuth popup. 30 min covers slow users plus clock skew; anything stale
// beyond that is almost certainly an abandoned flow.
const ANON_TTL_MS = 30 * 60 * 1000;

function isAnonId(uid: string): boolean {
  return uid.startsWith(ANON_PREFIX);
}

function anonKey(uid: string): string {
  return uid.slice(ANON_PREFIX.length);
}

function readState(): StoredState {
  const uid = getCurrentUserId();
  if (isAnonId(uid)) {
    const key = anonKey(uid);
    let s = anonStates.get(key);
    if (!s) {
      s = {};
      anonStates.set(key, s);
      anonCreatedAt.set(key, Date.now());
    }
    return s;
  }
  return getBaseMcpSession<StoredState>() ?? {};
}

async function writeState(state: StoredState): Promise<void> {
  const uid = getCurrentUserId();
  if (isAnonId(uid)) {
    const key = anonKey(uid);
    anonStates.set(key, state);
    if (!anonCreatedAt.has(key)) anonCreatedAt.set(key, Date.now());
    return;
  }
  await setBaseMcpSession(state);
}

// Purge all in-memory artifacts for an anon id (state, provider, mcp client,
// transport, tools cache). Called when the OAuth upgrade fails so abandoned
// half-finished flows don't accumulate. Idempotent.
export function purgeAnonOAuthState(anonId: string): void {
  anonStates.delete(anonId);
  anonCreatedAt.delete(anonId);
  const anonUid = `${ANON_PREFIX}${anonId}`;
  const t = transports.get(anonUid);
  if (t) {
    void t.close().catch(() => {
      // ignore — best effort
    });
  }
  providers.delete(anonUid);
  clients.delete(anonUid);
  transports.delete(anonUid);
  toolsCaches.delete(anonUid);
  lastUsed.delete(anonUid);
}

function getRedirectUri(): string {
  // Domain-agnostic: derived from the incoming request's own
  // X-Forwarded-Proto/Host (trust proxy is set in app.ts). This is what lets
  // OAuth work transparently across preview, deployed, custom domain,
  // localhost, and Docker without any env config.
  //
  // PUBLIC_BASE_URL is an opt-in override for the rare cases where the
  // request origin isn't available (background jobs that touch MCP) or
  // where the proxy can't be trusted. Falls back to localhost as a last
  // resort so dev still works if you bypass the proxy.
  const fromReq = getActiveRequestOrigin();
  const base =
    fromReq ??
    process.env["PUBLIC_BASE_URL"]?.replace(/\/$/, "") ??
    "http://localhost:80";
  return `${base}/api/base-mcp/callback`;
}

class BunnyOAuthProvider implements OAuthClientProvider {
  pendingAuthUrl: URL | undefined = undefined;

  get redirectUrl(): string {
    return getRedirectUri();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [getRedirectUri()],
      client_name: "bunnyOS",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    const stored = readState().clientInformation;
    if (!stored) return undefined;
    // If the persisted registration was created under a different client_name
    // (e.g. an older release), drop it so the SDK re-registers with the
    // current name and Base's consent screen shows the up-to-date label.
    if (stored.client_name !== this.clientMetadata.client_name) {
      return undefined;
    }
    // If the saved registration's redirect URIs don't include the current
    // origin (e.g. PUBLIC_BASE_URL changed between deploys, or the user is
    // hitting a preview host vs. the production host), drop it. Otherwise
    // the SDK will send the stale redirect_uri to Base and the OAuth dance
    // will bounce back to the wrong server.
    const current = getRedirectUri();
    const registered = stored.redirect_uris ?? [];
    if (!registered.includes(current)) {
      return undefined;
    }
    return stored;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    const state = readState();
    state.clientInformation = info;
    await writeState(state);
  }

  tokens(): OAuthTokens | undefined {
    return readState().tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const state = readState();
    state.tokens = tokens;
    await writeState(state);
  }

  async state(): Promise<string> {
    const s = randomBytes(16).toString("hex");
    const stored = readState();
    stored.oauthState = s;
    await writeState(stored);
    return s;
  }

  redirectToAuthorization(url: URL): void {
    this.pendingAuthUrl = url;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    const state = readState();
    state.codeVerifier = verifier;
    await writeState(state);
  }

  codeVerifier(): string {
    const v = readState().codeVerifier;
    if (!v) throw new Error("Missing PKCE code verifier");
    return v;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    const state = readState();
    if (scope === "all" || scope === "tokens") delete state.tokens;
    if (scope === "all" || scope === "client") delete state.clientInformation;
    if (scope === "all" || scope === "verifier") delete state.codeVerifier;
    if (scope === "all") delete state.oauthState;
    await writeState(state);
  }
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Per-user state. Keyed by userId from AsyncLocalStorage so each authenticated
// user holds an independent OAuth provider + MCP client + transport + tools cache.
// Without this, the first user to connect Base MCP locks everyone else out.
const providers = new Map<string, BunnyOAuthProvider>();
const clients = new Map<string, Client>();
const transports = new Map<string, StreamableHTTPClientTransport>();
const toolsCaches = new Map<string, McpTool[]>();
const lastUsed = new Map<string, number>();

// Lazy idle eviction: close MCP clients not used in IDLE_MS so memory doesn't
// grow with every user who ever signed in. Run periodically, not on every call.
const IDLE_MS = 30 * 60 * 1000;
const evictTimer = setInterval(() => {
  const now = Date.now();
  for (const [uid, ts] of lastUsed) {
    if (now - ts < IDLE_MS) continue;
    const t = transports.get(uid);
    if (t) {
      void t.close().catch(() => {
        // ignore
      });
    }
    transports.delete(uid);
    clients.delete(uid);
    toolsCaches.delete(uid);
    lastUsed.delete(uid);
  }
  // Evict abandoned anon OAuth flows too — these have no `lastUsed` entry
  // until tryConnect runs, so we age them by creation time instead.
  for (const [key, createdAt] of anonCreatedAt) {
    if (now - createdAt < ANON_TTL_MS) continue;
    purgeAnonOAuthState(key);
  }
}, 5 * 60 * 1000);
evictTimer.unref();

function touch(userId: string): void {
  lastUsed.set(userId, Date.now());
}

function getProvider(): BunnyOAuthProvider {
  const userId = getCurrentUserId();
  let p = providers.get(userId);
  if (!p) {
    p = new BunnyOAuthProvider();
    providers.set(userId, p);
  }
  return p;
}

function makeTransport(provider: BunnyOAuthProvider): StreamableHTTPClientTransport {
  const opts: StreamableHTTPClientTransportOptions = { authProvider: provider };
  return new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), opts);
}

async function tryConnect(): Promise<
  | { kind: "connected"; client: Client }
  | { kind: "needs_auth"; authUrl: string }
  | { kind: "error"; message: string }
> {
  const userId = getCurrentUserId();
  const provider = getProvider();
  provider.pendingAuthUrl = undefined;

  const existingClient = clients.get(userId);
  const existingTransport = transports.get(userId);
  if (existingClient && existingTransport) {
    touch(userId);
    return { kind: "connected", client: existingClient };
  }

  const transport = makeTransport(provider);
  const client = new Client(
    { name: "bunny-defi-companion", version: "0.1.1" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    clients.set(userId, client);
    transports.set(userId, transport);
    touch(userId);
    logger.info({ userId }, "Connected to Base MCP");
    return { kind: "connected", client };
  } catch (err) {
    const pending = provider.pendingAuthUrl as URL | undefined;
    if (err instanceof UnauthorizedError && pending !== undefined) {
      return { kind: "needs_auth", authUrl: String(pending) };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, userId }, "Base MCP connect failed");
    return { kind: "error", message };
  }
}

export interface BaseMcpStatus {
  connected: boolean;
  toolCount: number;
  tools: string[];
}

function clearConnection(userId: string): void {
  clients.delete(userId);
  transports.delete(userId);
  toolsCaches.delete(userId);
  lastUsed.delete(userId);
}

export async function getStatus(): Promise<BaseMcpStatus> {
  const provider = getProvider();
  const hasTokens = !!provider.tokens();
  if (!hasTokens) {
    return { connected: false, toolCount: 0, tools: [] };
  }
  try {
    const tools = await listTools();
    return { connected: true, toolCount: tools.length, tools: tools.map((t) => t.name) };
  } catch (err) {
    logger.warn({ err }, "getStatus: failed to list tools");
    return { connected: false, toolCount: 0, tools: [] };
  }
}

export async function startAuthFlow(): Promise<{ authUrl: string }> {
  const userId = getCurrentUserId();
  const provider = getProvider();
  await provider.invalidateCredentials("tokens");
  clearConnection(userId);

  const result = await tryConnect();
  if (result.kind === "needs_auth") return { authUrl: result.authUrl };
  if (result.kind === "connected") {
    throw new Error("Already connected — disconnect first");
  }
  throw new Error(result.message);
}

export async function finishAuthFlow(code: string, state: string): Promise<void> {
  const userId = getCurrentUserId();
  const expected = readState().oauthState;
  if (!expected || expected !== state) {
    throw new Error("Invalid OAuth state — possible CSRF");
  }
  const provider = getProvider();
  // Consume the state so it can't be replayed
  const cleared = readState();
  delete cleared.oauthState;
  await writeState(cleared);

  const transport = makeTransport(provider);
  await transport.finishAuth(code);

  clearConnection(userId);

  const client = new Client(
    { name: "bunny-defi-companion", version: "0.1.1" },
    { capabilities: {} },
  );
  const newTransport = makeTransport(provider);
  await client.connect(newTransport);
  clients.set(userId, client);
  transports.set(userId, newTransport);
  touch(userId);
  logger.info({ userId }, "Base MCP authorized and connected");
}

export async function disconnect(): Promise<void> {
  const userId = getCurrentUserId();
  const provider = getProvider();
  await provider.invalidateCredentials("all");
  const t = transports.get(userId);
  if (t) {
    try {
      await t.close();
    } catch (err) {
      logger.warn({ err, userId }, "Error closing MCP transport");
    }
  }
  clearConnection(userId);
}

export async function listTools(): Promise<McpTool[]> {
  const userId = getCurrentUserId();
  const cached = toolsCaches.get(userId);
  if (cached) {
    touch(userId);
    return cached;
  }
  const result = await tryConnect();
  if (result.kind !== "connected") {
    throw new Error(result.kind === "needs_auth" ? "Not authorized" : result.message);
  }
  const listed = await result.client.listTools();
  const tools = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
  }));
  toolsCaches.set(userId, tools);
  return tools;
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const result = await tryConnect();
  if (result.kind !== "connected") {
    throw new Error(result.kind === "needs_auth" ? "Not authorized" : result.message);
  }
  const res = await result.client.callTool({ name, arguments: args });
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

// Move an anon visitor's mid-flow OAuth state (tokens, client info, in-memory
// MCP client + transport) over to the real userId once we've learned their
// wallet address from get_wallets. Caller must invoke this from inside the
// anon's request context (so getBaseMcpSession resolution works correctly
// for the persist step via runWithUser).
export async function migrateAnonOAuthToUser(
  anonId: string,
  userId: string,
  persist: (state: StoredState) => Promise<void>,
): Promise<void> {
  const state = anonStates.get(anonId);
  if (!state) {
    throw new Error("No anon OAuth state to migrate");
  }
  // Persist to the user's DB-backed settings. Caller wraps in runWithUser.
  await persist(state);
  anonStates.delete(anonId);

  const anonUid = `${ANON_PREFIX}${anonId}`;
  const provider = providers.get(anonUid);
  if (provider) {
    providers.set(userId, provider);
    providers.delete(anonUid);
  }
  const client = clients.get(anonUid);
  if (client) {
    clients.set(userId, client);
    clients.delete(anonUid);
  }
  const transport = transports.get(anonUid);
  if (transport) {
    transports.set(userId, transport);
    transports.delete(anonUid);
  }
  const tools = toolsCaches.get(anonUid);
  if (tools) {
    toolsCaches.set(userId, tools);
    toolsCaches.delete(anonUid);
  }
  lastUsed.delete(anonUid);
  touch(userId);
}

export async function reconnectIfAuthorized(): Promise<void> {
  const provider = getProvider();
  if (!provider.tokens()) return;
  const result = await tryConnect();
  if (result.kind === "connected") {
    try {
      await listTools();
    } catch {
      // ignore
    }
  }
}
