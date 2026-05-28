import { db, workflowsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { type WorkflowDraft } from "./workflows";

const HOUR = 60 * 60_000;
const SIX_HOURS = 6 * HOUR;
const DAY = 24 * HOUR;

const DEFAULTS: WorkflowDraft[] = [
  {
    name: "empty wallet alert",
    enabled: true,
    intervalMs: SIX_HOURS,
    instructions:
      "call get_portfolio. if the wallet holds no assets at all (totalUsdValue is 0 or missing, and tokens list is empty), call emit_alert with title 'wallet is empty' and a summary telling the user to open base.org/app to buy assets or transfer in before bunnyOS can do anything useful. severity 'info'. if the wallet has any assets, stop silently.",
    toolAllowlist: null,
  },
  {
    name: "stable yield rec",
    enabled: true,
    intervalMs: HOUR,
    instructions:
      "call get_portfolio. if the user holds at least $25 worth of ETH or USDC sitting idle (not already deposited in morpho/aave/etc), look up the highest-tvl reputable usdc vault on base (e.g. morpho gauntlet/steakhouse usdc) using defillama or morpho tools. emit_recommendation with title 'park stables in morpho', why explaining their idle balance and the vault's apy/tvl, and executeInstructions like 'deposit <2-5% of total portfolio value> USDC into the <vault name> morpho vault on base'. only emit once unless conditions materially change. if balances are already largely deployed, stop silently.",
    toolAllowlist: null,
  },
  {
    name: "new base listings",
    enabled: true,
    intervalMs: SIX_HOURS,
    instructions:
      "call moralis_trending_tokens with chain='base', limit=50 to get the current trending tokens on base ranked by trading activity. then filter the result client-side to tokens where (a) createdAt is within the last 7 days (unix seconds, so createdAt >= now-7*86400), (b) liquidityUsd >= 15000, and (c) totalVolume.24h >= 25000 — this excludes empty/dead pairings and old tokens. sort the survivors by createdAt desc and take the top 5. for each, call emit_alert separately with title '<symbol> — fresh on base' and a summary including token name, contract address, 24h volume, liquidity, current price, market cap, holder count, and age in days. severity 'info'. if zero tokens survive the filter, stop silently.",
    toolAllowlist: ["moralis_trending_tokens"],
  },
  {
    name: "eth price move",
    enabled: true,
    intervalMs: HOUR,
    instructions:
      "call cmc_quotes_latest for ETH. if the 24h percent change is at least +5% or at most -5%, emit_alert with title 'ETH <up|down> X% (24h)' and a one-line summary with current price and the move. severity 'warn' if |move| >= 10%, else 'info'. if the move is smaller, stop silently.",
    toolAllowlist: ["cmc_quotes_latest"],
  },
  {
    name: "portfolio daily brief",
    enabled: true,
    intervalMs: DAY,
    instructions:
      "call get_portfolio. emit_alert exactly once with title 'daily brief — $<total>' and a 2-3 sentence summary covering: total usd value, top 3 holdings by value (symbol + usd), and one notable change vs last brief if obvious (e.g. 'usdc balance grew', 'no new positions'). severity 'info'. if the portfolio is empty, stop silently — the empty-wallet action handles that case.",
    toolAllowlist: null,
  },
  {
    name: "stablecoin depeg watch",
    enabled: true,
    intervalMs: HOUR,
    instructions:
      "call cmc_quotes_latest for USDC, USDT, and DAI in one batch. for any stablecoin whose price deviates more than 0.5% from $1.00 (i.e. < $0.995 or > $1.005), emit_alert separately with title '<symbol> depeg — $<price>' and a one-line summary noting the deviation and that holders should consider reducing exposure if it widens. severity 'warn' for >=0.5%, 'critical' for >=2%. if all three are within band, stop silently.",
    toolAllowlist: ["cmc_quotes_latest"],
  },
];

function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

// Atomic: takes a per-user pg advisory lock for the duration of the
// transaction so two concurrent OAuth callbacks for the same wallet cannot
// both pass the zero-workflows check and double-seed. Caller must be inside
// runWithUser(userId, ...) only for log/context consistency — the insert
// itself takes userId explicitly.
export async function seedDefaultActionsIfEmpty(userId: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`,
      );

      const [row] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(workflowsTable)
        .where(eq(workflowsTable.userId, userId));
      if ((row?.c ?? 0) > 0) return;

      await tx.insert(workflowsTable).values(
        DEFAULTS.map((d) => ({
          id: newId(),
          userId,
          name: d.name,
          enabled: d.enabled,
          intervalMs: d.intervalMs,
          instructions: d.instructions,
          toolAllowlist: d.toolAllowlist,
        })),
      );

      logger.info(
        { userId, count: DEFAULTS.length },
        "seeded default actions for user",
      );
    });
  } catch (err) {
    logger.warn({ err, userId }, "seedDefaultActionsIfEmpty failed");
  }
}
