// The "starter pack" of native actions, shipped in code and seeded per user.
//
// These are the source of truth for the native (built-in) actions. They are
// upserted into each user's `workflows` rows with source="native" the first
// time we see that user in-process (see seedNativeWorkflows in lib/workflows).
// Re-seeding refreshes the definition fields (name/interval/instructions/tools)
// but never the user's enabled toggle, so toggling a native off sticks while
// definition tweaks shipped in a new release still land.
//
// intervalMs must be one of ALLOWED_INTERVALS_MS (see lib/workflows). We use the
// nearest sensible allowed cadence per action. toolAllowlist is left null (all
// enabled tools) — the runner's write-tool denylist already blocks execution,
// and a null allowlist avoids brittle exact tool-name matching across protocol
// toggles.

const M5 = 5 * 60_000;
const M10 = 10 * 60_000;
const M30 = 30 * 60_000;
const H1 = 60 * 60_000;
const H6 = 6 * 60 * 60_000;
const D1 = 24 * 60 * 60_000;

export interface NativeActionDef {
  // Stable key — used to derive the per-user row id (nv:<key>:<userId>) and to
  // re-match a seeded row to its code definition. Never change a key in place;
  // changing it orphans the old seeded row and creates a new one.
  key: string;
  name: string;
  intervalMs: number;
  instructions: string;
  toolAllowlist: string[] | null;
}

export const NATIVE_ACTIONS: NativeActionDef[] = [
  // ----- new tokens to buy (most important) -----
  {
    key: "fresh-launch-radar",
    name: "fresh launch radar",
    intervalMs: H1,
    toolAllowlist: null,
    instructions:
      "from moralis trending tokens on base, find tokens created within the last 48h with liquidity over $150k. recommend the top 3 by 24h volume, with symbol, liquidity, and 24h change.",
  },
  {
    key: "traction-breakout",
    name: "traction breakout",
    intervalMs: H1,
    toolAllowlist: null,
    instructions:
      "pull trending tokens on base via moralis. recommend any token with 24h volume over $1M, liquidity over $250k, and 24h price change over 15%. skip liquidity under $100k. top 3 only.",
  },
  {
    key: "liquidity-floor-screen",
    name: "safer entries",
    intervalMs: H6,
    toolAllowlist: null,
    instructions:
      "from moralis trending tokens on base, list tokens where liquidity is over $500k and holders is over 1000. recommend the two cleanest as lower-risk entries, citing liquidity and holder count.",
  },
  {
    key: "rug-filter",
    name: "rug filter",
    intervalMs: H6,
    toolAllowlist: null,
    instructions:
      "for the top trending base tokens, pull moralis token metadata and holders. post a critical alert on any where the top holder owns more than 30% of supply or the token looks unverified. protective only.",
  },

  // ----- yield (most important) -----
  {
    key: "position-yield-monitor",
    name: "position yield monitor",
    intervalMs: H6,
    toolAllowlist: null,
    instructions:
      "pull my wallet defi positions via moralis. if the apy on any position drops below 4%, post an alert and, if defi llama shows a clearly better base option, recommend moving into it.",
  },
  {
    key: "rotation-scout",
    name: "yield rotation",
    intervalMs: H6,
    toolAllowlist: null,
    instructions:
      "compare my best current position apy (from moralis wallet defi positions) against the top usdc yields on base from defi llama. if the gap is over 150 bps, recommend rotating, naming source and target.",
  },
  {
    key: "idle-balance-to-yield",
    name: "idle cash to yield",
    intervalMs: H6,
    toolAllowlist: null,
    instructions:
      "check my moralis wallet tokens. if i am holding more than $200 of an unlent stablecoin, recommend the best risk-adjusted base supply market for it using defi llama.",
  },
  {
    key: "unclaimed-rewards",
    name: "unclaimed rewards",
    intervalMs: D1,
    toolAllowlist: null,
    instructions:
      "check my moralis wallet defi positions for claimable rewards. if unclaimed rewards are worth more than $25, recommend claiming and suggest where to redeploy them.",
  },

  // ----- portfolio (daily digests) -----
  {
    key: "defi-summary-digest",
    name: "defi summary digest",
    intervalMs: D1,
    toolAllowlist: null,
    instructions:
      "once a day, pull my moralis wallet defi summary and post an info alert with total deployed value, total unclaimed rewards, and weighted apy across protocols.",
  },
  {
    key: "pnl-digest",
    name: "pnl digest",
    intervalMs: D1,
    toolAllowlist: null,
    instructions:
      "once a day, pull my moralis wallet profitability summary and post an info alert with net realized and unrealized pnl, plus my best and worst position.",
  },
  {
    key: "holdings-drift",
    name: "holdings drift",
    intervalMs: D1,
    toolAllowlist: null,
    instructions:
      "from my moralis wallet tokens, if any single token exceeds 40% of total wallet value, recommend a rebalance target to bring it back in line.",
  },
  {
    key: "gas-reserve",
    name: "gas reserve",
    intervalMs: H6,
    toolAllowlist: null,
    instructions:
      "check my moralis wallet native balance. if my eth for gas drops below a safe floor (about 0.002 eth), post a warn alert to top up before i get stuck mid-transaction.",
  },
];
