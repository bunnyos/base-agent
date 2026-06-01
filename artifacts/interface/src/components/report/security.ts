// Derives the displayable contract-security items (label / value / tone) from a
// raw GoPlus TokenSecurity payload. Shared by the on-screen badges and the PDF
// security table so both stay in sync.

export type Tone = "ok" | "warn" | "bad" | "muted";

export type TokenSecurity = {
  address: string;
  isHoneypot: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
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
  ownerPercent: number | null;
  creatorPercent: number | null;
  topHolderPercent: number | null;
  holderCount: number | null;
};

export type SecurityItem = { label: string; value: string; tone: Tone };

export function deriveSecurityItems(s: TokenSecurity): SecurityItem[] {
  const items: SecurityItem[] = [];

  // flag: a boolean trait. `badWhenTrue` decides which value is the red flag.
  const flag = (label: string, v: boolean | null, badWhenTrue: boolean) => {
    if (v === null) {
      items.push({ label, value: "?", tone: "muted" });
      return;
    }
    const bad = badWhenTrue ? v : !v;
    items.push({ label, value: v ? "yes" : "no", tone: bad ? "bad" : "ok" });
  };

  const tax = (label: string, v: number | null) => {
    if (v === null) {
      items.push({ label, value: "?", tone: "muted" });
      return;
    }
    const tone: Tone = v >= 10 ? "bad" : v >= 5 ? "warn" : "ok";
    items.push({ label, value: `${v.toFixed(1)}%`, tone });
  };

  const concentration = (label: string, v: number | null) => {
    if (v === null) {
      items.push({ label, value: "?", tone: "muted" });
      return;
    }
    const tone: Tone = v >= 30 ? "bad" : v >= 15 ? "warn" : "ok";
    items.push({ label, value: `${v.toFixed(1)}%`, tone });
  };

  flag("honeypot", s.isHoneypot, true);
  flag("open source", s.isOpenSource, false);
  flag("mintable", s.isMintable, true);
  flag("pausable", s.transferPausable, true);
  flag("reclaim ownership", s.canTakeBackOwnership, true);
  flag("hidden owner", s.hiddenOwner, true);
  flag("blacklist", s.isBlacklisted, true);
  flag("proxy", s.isProxy, true);
  tax("buy tax", s.buyTax);
  tax("sell tax", s.sellTax);
  concentration("owner", s.ownerPercent);
  concentration("top holder", s.topHolderPercent);

  return items;
}
