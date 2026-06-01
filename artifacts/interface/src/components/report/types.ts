import type { TokenSecurity } from "./security";

// The subset of token fields the report views need. Structurally compatible
// with the explorer's TrendingToken, so a TrendingToken can be passed directly.
export type ReportToken = {
  tokenAddress: string;
  symbol: string;
  name: string;
  usdPrice: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  createdAt: number | null;
  pricePercentChange1h: number | null;
  pricePercentChange24h: number | null;
  totalVolume24h: number | null;
};

// One close-price + volume point per daily candle, used to draw the static
// price chart embedded in the PDF report.
export type ChartPoint = {
  t: number; // unix seconds (candle open time)
  c: number; // close price, usd
  v: number; // volume, usd
};

export type ReportData = {
  token: ReportToken;
  security: TokenSecurity | null;
  analysis: string;
  chart: ChartPoint[];
  generatedAt: Date;
};
