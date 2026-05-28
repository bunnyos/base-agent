// Simple per-(userId, op) token bucket. In-memory — fine for single-process.
// Multi-instance deployments would need Redis-backed buckets; out of scope.

interface Bucket {
  tokens: number;
  lastRefill: number; // epoch ms
}

interface BucketSpec {
  capacity: number;
  refillPerSec: number;
}

const SPECS: Record<string, BucketSpec> = {
  chat: { capacity: 60, refillPerSec: 60 / 3600 }, // 60/hour
  scan: { capacity: 12, refillPerSec: 12 / 3600 }, // 12/hour
};

const buckets = new Map<string, Bucket>();

function keyOf(userId: string, op: string): string {
  return `${userId}::${op}`;
}

// Periodically evict buckets that have been at full capacity for a long time
// (i.e. the user is inactive). Without this the Map grows unbounded with
// every unique (userId, op) pair that has ever connected.
const EVICT_INTERVAL_MS = 10 * 60 * 1000;
const EVICT_IDLE_MS = 60 * 60 * 1000; // 1h of inactivity
setInterval(() => {
  const cutoff = Date.now() - EVICT_IDLE_MS;
  for (const [k, b] of buckets) {
    if (b.lastRefill < cutoff) buckets.delete(k);
  }
}, EVICT_INTERVAL_MS).unref();

function get(spec: BucketSpec, key: string): Bucket {
  const existing = buckets.get(key);
  const now = Date.now();
  if (!existing) {
    const b: Bucket = { tokens: spec.capacity, lastRefill: now };
    buckets.set(key, b);
    return b;
  }
  const elapsedSec = (now - existing.lastRefill) / 1000;
  if (elapsedSec > 0) {
    existing.tokens = Math.min(
      spec.capacity,
      existing.tokens + elapsedSec * spec.refillPerSec,
    );
    existing.lastRefill = now;
  }
  return existing;
}

export interface RateCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

export function take(userId: string, op: keyof typeof SPECS): RateCheck {
  const spec = SPECS[op];
  if (!spec) throw new Error(`unknown rate-limit op: ${op}`);
  const b = get(spec, keyOf(userId, op));
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(b.tokens),
      retryAfterSec: 0,
      limit: spec.capacity,
    };
  }
  const need = 1 - b.tokens;
  const retryAfterSec = Math.max(1, Math.ceil(need / spec.refillPerSec));
  return {
    allowed: false,
    remaining: 0,
    retryAfterSec,
    limit: spec.capacity,
  };
}
