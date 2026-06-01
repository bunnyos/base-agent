import { logger } from "./logger";

// GoPlus Labs token security API (free, no key required for the basic
// token_security endpoint, ~30 req/min by IP). Base chain id is 8453.
// Docs: https://docs.gopluslabs.io/reference/tokensecurityusingget_1
const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";
const BASE_CHAIN_ID = "8453";

export interface TokenSecurity {
  address: string;
  // null = field absent / unknown from GoPlus.
  isHoneypot: boolean | null;
  buyTax: number | null; // percent, 0-100
  sellTax: number | null; // percent, 0-100
  isOpenSource: boolean | null;
  isProxy: boolean | null;
  isMintable: boolean | null;
  canTakeBackOwnership: boolean | null;
  transferPausable: boolean | null;
  tradingCooldown: boolean | null;
  hiddenOwner: boolean | null;
  cannotSellAll: boolean | null;
  cannotBuy: boolean | null;
  isBlacklisted: boolean | null;
  isInDex: boolean | null;
  ownerPercent: number | null; // percent of supply held by owner, 0-100
  creatorPercent: number | null; // percent of supply held by creator, 0-100
  topHolderPercent: number | null; // percent of supply held by largest holder
  holderCount: number | null;
}

function toBool(v: unknown): boolean | null {
  if (v === "1" || v === 1 || v === true) return true;
  if (v === "0" || v === 0 || v === false) return false;
  return null;
}

// GoPlus returns ratios as decimal strings ("0.05" = 5%). Convert to percent.
function ratioToPct(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return n * 100;
}

function toInt(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

interface GoPlusHolder {
  percent?: string;
}

interface GoPlusEntry {
  is_honeypot?: string;
  buy_tax?: string;
  sell_tax?: string;
  is_open_source?: string;
  is_proxy?: string;
  is_mintable?: string;
  can_take_back_ownership?: string;
  transfer_pausable?: string;
  trading_cooldown?: string;
  hidden_owner?: string;
  cannot_sell_all?: string;
  cannot_buy?: string;
  is_blacklisted?: string;
  is_in_dex?: string;
  owner_percent?: string;
  creator_percent?: string;
  holder_count?: string;
  holders?: GoPlusHolder[];
}

function normalize(address: string, e: GoPlusEntry): TokenSecurity {
  const topHolder = Array.isArray(e.holders) && e.holders.length > 0
    ? ratioToPct(e.holders[0]?.percent)
    : null;
  return {
    address,
    isHoneypot: toBool(e.is_honeypot),
    buyTax: ratioToPct(e.buy_tax),
    sellTax: ratioToPct(e.sell_tax),
    isOpenSource: toBool(e.is_open_source),
    isProxy: toBool(e.is_proxy),
    isMintable: toBool(e.is_mintable),
    canTakeBackOwnership: toBool(e.can_take_back_ownership),
    transferPausable: toBool(e.transfer_pausable),
    tradingCooldown: toBool(e.trading_cooldown),
    hiddenOwner: toBool(e.hidden_owner),
    cannotSellAll: toBool(e.cannot_sell_all),
    cannotBuy: toBool(e.cannot_buy),
    isBlacklisted: toBool(e.is_blacklisted),
    isInDex: toBool(e.is_in_dex),
    ownerPercent: ratioToPct(e.owner_percent),
    creatorPercent: ratioToPct(e.creator_percent),
    topHolderPercent: topHolder,
    holderCount: toInt(e.holder_count),
  };
}

interface CacheEntry {
  at: number;
  data: TokenSecurity | null;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

// GoPlus throttles keyless (anonymous) callers by IP. When it tells us "too
// many requests" we stop hitting it for a short window across ALL addresses,
// returning null (no badges) instead of amplifying the rate limit.
const RATE_LIMIT_BACKOFF_MS = 30 * 1000;
let rateLimitedUntil = 0;

// Periodically drop expired entries so the cache can't grow unbounded with
// every unique contract address that's ever been looked up.
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of cache) {
    if (v.at < cutoff) cache.delete(k);
  }
}, TTL_MS).unref();

// Returns normalized security info for a Base token, or null if GoPlus has no
// data for the contract. Throws only on network / unexpected-shape failures.
export async function getTokenSecurity(
  address: string,
): Promise<TokenSecurity | null> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  // Honor an active backoff window — don't hit GoPlus while throttled.
  if (Date.now() < rateLimitedUntil) return null;

  const url = `${GOPLUS_BASE}/token_security/${BASE_CHAIN_ID}?contract_addresses=${key}`;
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  // HTTP 429 = throttled. Back off and return null instead of erroring.
  if (resp.status === 429) {
    rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    return null;
  }
  if (!resp.ok) {
    throw new Error(`goplus ${resp.status}`);
  }
  const json = (await resp.json()) as {
    code?: number;
    message?: string;
    result?: Record<string, GoPlusEntry>;
  };
  // GoPlus returns HTTP 200 with code 4029 ("too many requests") when the
  // keyless IP quota is exceeded — treat it as a soft rate limit (back off,
  // return null), not a hard error and not permanent "no data".
  if (json.code === 4029) {
    rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    return null;
  }
  // Any other non-1 code is a real logical error (bad params, upstream issue).
  if (json.code !== undefined && json.code !== 1) {
    throw new Error(`goplus code ${json.code}: ${json.message ?? "error"}`);
  }
  const entry = json.result?.[key];
  const data = entry ? normalize(key, entry) : null;
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Short, terminal-style block injected into the AI report prompt so the model
// can factor contract security into its risk assessment.
export function summarizeSecurity(s: TokenSecurity): string {
  const yn = (b: boolean | null): string =>
    b === null ? "unknown" : b ? "yes" : "no";
  const pct = (n: number | null): string =>
    n === null ? "unknown" : `${n.toFixed(1)}%`;
  return [
    `security (goplus):`,
    `- honeypot: ${yn(s.isHoneypot)}`,
    `- buy tax: ${pct(s.buyTax)} | sell tax: ${pct(s.sellTax)}`,
    `- open source: ${yn(s.isOpenSource)} | proxy: ${yn(s.isProxy)} | mintable: ${yn(s.isMintable)}`,
    `- can reclaim ownership: ${yn(s.canTakeBackOwnership)} | hidden owner: ${yn(s.hiddenOwner)} | pausable: ${yn(s.transferPausable)} | blacklist: ${yn(s.isBlacklisted)}`,
    `- owner holds: ${pct(s.ownerPercent)} | top holder: ${pct(s.topHolderPercent)}`,
  ].join("\n");
}

// Best-effort wrapper that never throws — for use in the report hot path where
// missing security data should not fail the whole report.
export async function getTokenSecuritySafe(
  address: string,
): Promise<TokenSecurity | null> {
  try {
    return await getTokenSecurity(address);
  } catch (err) {
    logger.warn({ err, address }, "goplus security lookup failed");
    return null;
  }
}
