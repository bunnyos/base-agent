import type { Candle } from "./pyth-history";

// Pure, dependency-free technical-analysis math. Each helper returns null when
// there isn't enough data so callers can omit the line rather than print NaN.

function sma(vals: number[], n: number): number | null {
  if (vals.length < n) return null;
  let s = 0;
  for (let i = vals.length - n; i < vals.length; i++) s += vals[i];
  return s / n;
}

function emaSeries(vals: number[], n: number): number[] {
  if (vals.length === 0) return [];
  const k = 2 / (n + 1);
  const out: number[] = [vals[0]];
  for (let i = 1; i < vals.length; i++) {
    out.push(vals[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function emaLast(vals: number[], n: number): number | null {
  if (vals.length < n) return null;
  const s = emaSeries(vals, n);
  return s[s.length - 1] ?? null;
}

function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: number; signal: number; hist: number } | null {
  if (closes.length < slow + signal) return null;
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) => fastE[i] - slowE[i]);
  const signalE = emaSeries(macdLine, signal);
  const m = macdLine[macdLine.length - 1];
  const s = signalE[signalE.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

function bollinger(
  closes: number[],
  n = 20,
  k = 2,
): { upper: number; mid: number; lower: number } | null {
  if (closes.length < n) return null;
  const slice = closes.slice(closes.length - n);
  const mid = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  return { upper: mid + k * sd, mid, lower: mid - k * sd };
}

function atr(candles: Candle[], n = 14): number | null {
  if (candles.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(
      Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)),
    );
  }
  let a = sma(trs.slice(0, n), n) ?? trs[0];
  for (let i = n; i < trs.length; i++) {
    a = (a * (n - 1) + trs[i]) / n;
  }
  return a;
}

export interface TimeframeAnalysis {
  label: string;
  candles: number;
  close: number;
  sma20: number | null;
  sma50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macdHist: number | null;
  boll: { upper: number; mid: number; lower: number } | null;
  atr14: number | null;
  high: number;
  low: number;
  changePct: number | null;
}

export function analyzeTimeframe(
  label: string,
  candles: Candle[],
): TimeframeAnalysis | null {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => c.c);
  const close = closes[closes.length - 1];
  const first = closes[0];
  return {
    label,
    candles: candles.length,
    close,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema200: emaLast(closes, 200),
    rsi14: rsi(closes, 14),
    macdHist: macd(closes)?.hist ?? null,
    boll: bollinger(closes, 20, 2),
    atr14: atr(candles, 14),
    high: Math.max(...candles.map((c) => c.h)),
    low: Math.min(...candles.map((c) => c.l)),
    changePct: first !== 0 ? ((close - first) / first) * 100 : null,
  };
}

function n2(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(4);
  return v.toPrecision(4);
}

function rel(close: number, ref: number | null): string {
  if (ref === null) return "n/a";
  return close >= ref ? "above" : "below";
}

// Compact, model-friendly text block for one timeframe. Only includes lines the
// data supports.
export function summarizeTimeframe(a: TimeframeAnalysis): string {
  const lines: string[] = [`[${a.label} · ${a.candles} candles]`];
  lines.push(`close ${n2(a.close)}`);
  const ma: string[] = [];
  if (a.sma20 !== null) ma.push(`20sma ${n2(a.sma20)} (${rel(a.close, a.sma20)})`);
  if (a.sma50 !== null) ma.push(`50sma ${n2(a.sma50)} (${rel(a.close, a.sma50)})`);
  if (a.ema200 !== null)
    ma.push(`200ema ${n2(a.ema200)} (${rel(a.close, a.ema200)})`);
  if (ma.length) lines.push(ma.join(" | "));
  const mom: string[] = [];
  if (a.rsi14 !== null) mom.push(`rsi14 ${a.rsi14.toFixed(1)}`);
  if (a.macdHist !== null)
    mom.push(`macd hist ${a.macdHist >= 0 ? "+" : ""}${n2(a.macdHist)} (${a.macdHist >= 0 ? "bullish" : "bearish"})`);
  if (a.boll) {
    const pos =
      a.close >= a.boll.upper
        ? "at/above upper"
        : a.close <= a.boll.lower
          ? "at/below lower"
          : a.close >= a.boll.mid
            ? "mid-upper"
            : "lower-mid";
    mom.push(`bb ${pos}`);
  }
  if (mom.length) lines.push(mom.join(" | "));
  const vol: string[] = [];
  if (a.atr14 !== null) {
    const pct = a.close !== 0 ? (a.atr14 / a.close) * 100 : null;
    vol.push(`atr14 ${n2(a.atr14)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ""}`);
  }
  vol.push(`range high ${n2(a.high)} / low ${n2(a.low)}`);
  if (a.changePct !== null)
    vol.push(`window chg ${a.changePct >= 0 ? "+" : ""}${a.changePct.toFixed(2)}%`);
  lines.push(vol.join(" | "));
  return lines.join("\n");
}
