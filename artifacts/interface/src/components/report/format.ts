// Shared number/date formatting for the token explorer table and report views.
// Kept in one place so the on-screen report and the PDF render identical values.

export function fmtUsd(v: number | null, compact = false): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (compact && a >= 1000) {
    const units = [
      { t: 1e9, s: "b" },
      { t: 1e6, s: "m" },
      { t: 1e3, s: "k" },
    ];
    for (const u of units) {
      if (a >= u.t) return `$${(v / u.t).toFixed(2)}${u.s}`;
    }
  }
  // Sub-dollar values (common for fresh token launches priced at ~1e-7) would
  // collapse to "$0" under fixed 2/6-decimal rounding. Scale the decimals to the
  // magnitude so ~3 significant figures survive, then trim trailing zeros.
  if (a > 0 && a < 1) {
    const decimals = Math.min(12, -Math.floor(Math.log10(a)) + 2);
    return `$${v.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function fmtNum(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US");
}

export function ageDays(createdAt: number | null): number | null {
  if (createdAt === null || !Number.isFinite(createdAt)) return null;
  return (Date.now() / 1000 - createdAt) / 86400;
}

export function fmtAge(createdAt: number | null): string {
  const d = ageDays(createdAt);
  if (d === null) return "—";
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  if (d < 30) return `${Math.round(d)}d`;
  return `${Math.round(d / 30)}mo`;
}
