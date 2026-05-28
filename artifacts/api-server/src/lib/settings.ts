import {
  db,
  userSettingsTable,
  userProtocolsTable,
  type UserSettings,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { getCurrentUserId } from "./user";
import { encrypt, tryDecrypt } from "./crypto";

// Per-user in-memory settings cache. Hydrated on-demand by the session
// middleware (and by the workflow scheduler before iterating a user). Reads
// are sync so the agent's tool-dispatch loop doesn't await per call; writes
// go to DB first, then update the cache.

interface CachedSettings {
  openrouterApiKey: string | null;
  moralisApiKey: string | null;
  cmcApiKey: string | null;
  model: string | null;
  memoryMd: string;
  baseMcpSession: unknown;
}

const DEFAULT_CACHE: CachedSettings = {
  openrouterApiKey: null,
  moralisApiKey: null,
  cmcApiKey: null,
  model: null,
  memoryMd: "",
  baseMcpSession: null,
};

const userCache = new Map<string, CachedSettings>();
const userProtocols = new Map<string, Map<string, boolean>>();

// API keys pasted from docs sites often pick up curly quotes, NBSPs, or
// trailing whitespace. fetch() then crashes with a cryptic "ByteString"
// error because HTTP headers must be ASCII. Strip anything outside the
// printable-ASCII range and trim, at save-time, so the cache never
// contains a key that can't be sent.
function sanitizeApiKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

interface EncEnvelope {
  enc: string;
}
function isEncEnvelope(v: unknown): v is EncEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    "enc" in v &&
    typeof (v as Record<string, unknown>)["enc"] === "string" &&
    ((v as Record<string, unknown>)["enc"] as string).startsWith("enc:v1:")
  );
}
function decryptJsonbSession(raw: unknown): unknown {
  if (raw == null) return null;
  if (isEncEnvelope(raw)) {
    try {
      return JSON.parse(tryDecrypt(raw.enc) ?? "null");
    } catch (err) {
      logger.error({ err }, "failed to decrypt base_mcp_session");
      return null;
    }
  }
  return raw;
}
function encryptJsonbSession(value: unknown): EncEnvelope | null {
  if (value == null) return null;
  return { enc: encrypt(JSON.stringify(value)) };
}

function sanitizeStoredKey(v: string | null): string | null {
  if (v == null) return null;
  const clean = sanitizeApiKey(v);
  return clean === "" ? null : clean;
}

function rowToCache(row: UserSettings): CachedSettings {
  return {
    openrouterApiKey: sanitizeStoredKey(tryDecrypt(row.openrouterApiKey)),
    moralisApiKey: sanitizeStoredKey(tryDecrypt(row.moralisApiKey)),
    cmcApiKey: sanitizeStoredKey(tryDecrypt(row.cmcApiKey)),
    model: row.model,
    memoryMd: row.memoryMd,
    baseMcpSession: decryptJsonbSession(row.baseMcpSession),
  };
}

const hydrating = new Map<string, Promise<void>>();
export async function hydrateUserSettings(userId: string): Promise<void> {
  if (userCache.has(userId)) return;
  const pending = hydrating.get(userId);
  if (pending) return pending;
  const p = (async () => {
    try {
      const [row] = await db
        .select()
        .from(userSettingsTable)
        .where(eq(userSettingsTable.userId, userId))
        .limit(1);
      const protocolMap = new Map<string, boolean>();
      const rows = await db
        .select()
        .from(userProtocolsTable)
        .where(eq(userProtocolsTable.userId, userId));
      for (const r of rows) protocolMap.set(r.protocolId, r.enabled);
      userCache.set(userId, row ? rowToCache(row) : { ...DEFAULT_CACHE });
      userProtocols.set(userId, protocolMap);
      logger.info(
        {
          userId,
          hasKey: Boolean(userCache.get(userId)?.openrouterApiKey),
          protocolCount: protocolMap.size,
        },
        "settings cache hydrated",
      );
    } finally {
      hydrating.delete(userId);
    }
  })();
  hydrating.set(userId, p);
  return p;
}

function getCache(): CachedSettings {
  const userId = getCurrentUserId();
  const c = userCache.get(userId);
  if (!c) {
    throw new Error(
      `settings cache not hydrated for user ${userId} — call hydrateUserSettings() first`,
    );
  }
  return c;
}

function getProtoCache(): Map<string, boolean> {
  const userId = getCurrentUserId();
  const m = userProtocols.get(userId);
  if (!m) {
    throw new Error(`protocols cache not hydrated for user ${userId}`);
  }
  return m;
}

async function patch(values: Partial<UserSettings>): Promise<void> {
  const userId = getCurrentUserId();
  const toWrite = { ...values, updatedAt: new Date() };
  await db
    .update(userSettingsTable)
    .set(toWrite)
    .where(eq(userSettingsTable.userId, userId));
}

// ---------- OpenRouter API key ----------

export function getApiKey(): string | undefined {
  return getCache().openrouterApiKey ?? undefined;
}

export async function setApiKey(key: string): Promise<void> {
  const clean = sanitizeApiKey(key);
  await patch({ openrouterApiKey: encrypt(clean) });
  getCache().openrouterApiKey = clean;
}

export async function clearApiKey(): Promise<void> {
  await patch({ openrouterApiKey: null });
  getCache().openrouterApiKey = null;
}

export function isUserKey(): boolean {
  return Boolean(getCache().openrouterApiKey);
}

// ---------- Moralis API key ----------

export function getMoralisApiKey(): string | undefined {
  return getCache().moralisApiKey ?? undefined;
}

export async function setMoralisApiKey(key: string): Promise<void> {
  const clean = sanitizeApiKey(key);
  await patch({ moralisApiKey: encrypt(clean) });
  getCache().moralisApiKey = clean;
}

export async function clearMoralisApiKey(): Promise<void> {
  await patch({ moralisApiKey: null });
  getCache().moralisApiKey = null;
}

export function isUserMoralisKey(): boolean {
  return Boolean(getCache().moralisApiKey);
}

// ---------- CoinMarketCap API key ----------

export function getCmcApiKey(): string | undefined {
  return (
    getCache().cmcApiKey ??
    undefined
  );
}

export async function setCmcApiKey(key: string): Promise<void> {
  const clean = sanitizeApiKey(key);
  await patch({ cmcApiKey: encrypt(clean) });
  getCache().cmcApiKey = clean;
}

export async function clearCmcApiKey(): Promise<void> {
  await patch({ cmcApiKey: null });
  getCache().cmcApiKey = null;
}

export function isUserCmcKey(): boolean {
  return Boolean(getCache().cmcApiKey);
}

// ---------- Model ----------

export function getStoredModel(): string | undefined {
  return getCache().model ?? undefined;
}

export async function setStoredModel(model: string): Promise<void> {
  await patch({ model });
  getCache().model = model;
}

// ---------- Protocols ----------

// Protocols the user cannot disable. `base` is the wallet itself (no
// point running bunny without it). `cmc` is the price oracle every
// other tool implicitly depends on for USD valuation and discovery.
const REQUIRED_PROTOCOLS = new Set(["base", "cmc"]);

export function isProtocolEnabled(id: string): boolean {
  if (REQUIRED_PROTOCOLS.has(id)) return true;
  const v = getProtoCache().get(id);
  return v === undefined ? true : v;
}

export async function setProtocolEnabled(id: string, enabled: boolean): Promise<void> {
  if (REQUIRED_PROTOCOLS.has(id)) {
    getProtoCache().set(id, true);
    return;
  }
  const userId = getCurrentUserId();
  await db
    .insert(userProtocolsTable)
    .values({ userId, protocolId: id, enabled })
    .onConflictDoUpdate({
      target: [userProtocolsTable.userId, userProtocolsTable.protocolId],
      set: { enabled },
    });
  getProtoCache().set(id, enabled);
}

// ---------- Markdown blobs ----------

export function getMemoryMd(): string {
  return getCache().memoryMd;
}
export async function setMemoryMd(text: string): Promise<void> {
  await patch({ memoryMd: text });
  getCache().memoryMd = text;
}

// ---------- Base MCP oauth session blob (encrypted) ----------

export function getBaseMcpSession<T = unknown>(): T | null {
  return (getCache().baseMcpSession as T) ?? null;
}

export async function setBaseMcpSession(value: unknown): Promise<void> {
  const envelope = encryptJsonbSession(value);
  await patch({ baseMcpSession: envelope as never });
  getCache().baseMcpSession = value;
}

// ---------- Misc ----------

export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export async function deleteProtocolSetting(id: string): Promise<void> {
  const userId = getCurrentUserId();
  await db
    .delete(userProtocolsTable)
    .where(
      and(
        eq(userProtocolsTable.userId, userId),
        eq(userProtocolsTable.protocolId, id),
      ),
    );
  getProtoCache().delete(id);
}
