import { db, workflowsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// One-time data fixup: when CMC + DexScreener were consolidated onto CoinGecko,
// the tool names changed. User-authored and seeded workflow rows persist tool
// names in two places — the freeform `instructions` text and the
// `toolAllowlist` array — so any existing row referencing a legacy name would
// silently fail at run time (the dispatcher no longer knows cmc_*/dexscreener_*
// tools). This rewrites those references in place on boot. It's idempotent: a
// row already on the new names is left untouched and not re-written.
//
// Only the tool *name* is rewritten, not argument phrasing. The workflow runner
// is an LLM loop: `instructions` is a natural-language prompt and the agent
// derives each call's arguments from the renamed tool's inputSchema at run time,
// so a name-only rewrite keeps these workflows functional even when the new
// tool's parameter shape differs from the legacy one.
//
// Legacy tools with no CoinGecko equivalent are intentionally left out of the
// map (e.g. CMC's key/usage status — CoinGecko has no analog). An unmapped name
// stays as-is and simply becomes an unavailable tool, which is more honest than
// silently retargeting it to an unrelated endpoint.
const TOOL_RENAMES: Record<string, string> = {
  cmc_quotes_latest: "coingecko_price",
  cmc_quotes_by_address: "coingecko_token_price",
  cmc_listings_latest: "coingecko_markets",
  cmc_info: "coingecko_coin_info",
  cmc_map: "coingecko_search",
  cmc_global_metrics: "coingecko_global",
  cmc_price_conversion: "coingecko_price",
  dexscreener_token_pairs: "coingecko_onchain_token_data",
  dexscreener_search: "coingecko_onchain_search_pools",
};

// Longest-first so substrings can't shadow longer legacy names during text
// replacement (e.g. cmc_quotes_latest before any hypothetical cmc_quotes).
const RENAME_ENTRIES = Object.entries(TOOL_RENAMES).sort(
  (a, b) => b[0].length - a[0].length,
);

function rewriteText(text: string): string {
  let out = text;
  for (const [from, to] of RENAME_ENTRIES) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
    }
  }
  return out;
}

function rewriteAllowlist(list: string[] | null): {
  next: string[] | null;
  changed: boolean;
} {
  if (!Array.isArray(list)) return { next: list, changed: false };
  let changed = false;
  const mapped = list.map((name) => {
    const to = TOOL_RENAMES[name];
    if (to && to !== name) {
      changed = true;
      return to;
    }
    return name;
  });
  // Dedupe while preserving order (two legacy names can collapse onto one new
  // name, e.g. cmc_global_metrics + cmc_key_status -> coingecko_global).
  const deduped: string[] = [];
  for (const name of mapped) {
    if (!deduped.includes(name)) deduped.push(name);
  }
  if (deduped.length !== list.length) changed = true;
  return { next: deduped, changed };
}

export async function migrateLegacyToolNames(): Promise<void> {
  let rows;
  try {
    rows = await db
      .select({
        id: workflowsTable.id,
        instructions: workflowsTable.instructions,
        toolAllowlist: workflowsTable.toolAllowlist,
      })
      .from(workflowsTable);
  } catch (err) {
    logger.warn({ err }, "Legacy tool-name migration: failed to read workflows");
    return;
  }

  let migrated = 0;
  for (const row of rows) {
    const nextInstructions = rewriteText(row.instructions ?? "");
    const { next: nextAllowlist, changed: allowlistChanged } = rewriteAllowlist(
      row.toolAllowlist,
    );
    const instructionsChanged = nextInstructions !== (row.instructions ?? "");
    if (!instructionsChanged && !allowlistChanged) continue;
    try {
      await db
        .update(workflowsTable)
        .set({
          instructions: nextInstructions,
          toolAllowlist: nextAllowlist,
        })
        .where(eq(workflowsTable.id, row.id));
      migrated += 1;
    } catch (err) {
      logger.warn(
        { err, workflowId: row.id },
        "Legacy tool-name migration: failed to update workflow",
      );
    }
  }
  if (migrated > 0) {
    logger.info({ migrated }, "Rewrote legacy cmc_/dexscreener_ tool names");
  }
}
