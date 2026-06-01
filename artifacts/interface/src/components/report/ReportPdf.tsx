import {
  Document,
  Page,
  View,
  Text,
  Image,
  Link,
  StyleSheet,
  Svg,
  Polyline,
  Polygon,
  Rect,
  pdf,
} from "@react-pdf/renderer";
import { parseMarkdown, type Inline } from "./markdown-utils";
import { deriveSecurityItems, type Tone } from "./security";
import { fmtUsd, fmtPct, fmtNum, fmtAge } from "./format";
import type { ChartPoint, ReportData } from "./types";
import logoUrl from "@assets/logo.png";

// Footer call-to-action links, rendered at the end of every report.
const REPORT_LINKS: { label: string; url: string; display: string }[] = [
  { label: "Website", url: "https://bunnyos.ai/", display: "bunnyos.ai" },
  {
    label: "Support & Token",
    url: "https://app.virtuals.io/virtuals/80805",
    display: "app.virtuals.io/virtuals/80805",
  },
  {
    label: "GitHub",
    url: "https://github.com/bunnyos/base-agent",
    display: "github.com/bunnyos/base-agent",
  },
  { label: "X", url: "https://x.com/officialbunnyos", display: "@officialbunnyos" },
];

const COLORS = {
  ink: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  panel: "#f8fafc",
  brand: "#2563eb",
  ok: "#047857",
  warn: "#b45309",
  bad: "#b91c1c",
};

const TONE_COLOR: Record<Tone, string> = {
  ok: COLORS.ok,
  warn: COLORS.warn,
  bad: COLORS.bad,
  muted: COLORS.faint,
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.ink,
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingBottom: 14,
    marginBottom: 18,
  },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 16, color: COLORS.ink },
  brandAccent: { color: COLORS.brand },
  logo: { height: 34, width: 102, objectFit: "contain", marginBottom: 4 },
  kicker: {
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: COLORS.muted,
    marginTop: 3,
  },
  tokenName: { fontFamily: "Helvetica-Bold", fontSize: 13, textAlign: "right" },
  tokenSub: { fontSize: 8, color: COLORS.muted, textAlign: "right", marginTop: 2 },
  addr: {
    fontFamily: "Courier",
    fontSize: 7.5,
    color: COLORS.faint,
    textAlign: "right",
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: COLORS.muted,
    marginBottom: 8,
    fontFamily: "Helvetica-Bold",
  },
  chartMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  chartMeta: { fontSize: 8, color: COLORS.muted },
  chartDatesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
    marginBottom: 20,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 20 },
  stat: {
    width: "25%",
    paddingVertical: 6,
    paddingRight: 10,
  },
  statLabel: {
    fontSize: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: COLORS.muted,
  },
  statValue: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 2 },
  secGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 20 },
  secItem: {
    width: "33.33%",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingRight: 12,
  },
  secLabel: { fontSize: 9, color: COLORS.muted },
  secValue: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  heading: {
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: COLORS.muted,
    fontFamily: "Helvetica-Bold",
    marginTop: 12,
    marginBottom: 6,
  },
  paragraph: { fontSize: 10, marginBottom: 6 },
  listRow: { flexDirection: "row", marginBottom: 4, paddingRight: 8 },
  bullet: { width: 10, fontSize: 10, color: COLORS.faint },
  listText: { flex: 1, fontSize: 10 },
  bold: { fontFamily: "Helvetica-Bold" },
  divider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    marginTop: 6,
    marginBottom: 10,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 44,
    right: 44,
  },
  footerLine: { borderTopWidth: 1, borderTopColor: COLORS.line, marginBottom: 6 },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: COLORS.faint },
  disclaimer: { fontSize: 6.5, color: COLORS.faint, marginTop: 4, lineHeight: 1.4 },
  links: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 14,
  },
  linksEyebrow: {
    fontSize: 7,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: COLORS.faint,
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  linksLogo: { height: 30, width: 90, objectFit: "contain", marginBottom: 2 },
  linksTagline: { fontSize: 8.5, color: COLORS.muted, marginTop: 4, marginBottom: 12 },
  linkRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 6 },
  linkLabel: {
    fontSize: 9,
    color: COLORS.muted,
    width: 110,
    fontFamily: "Helvetica-Bold",
  },
  linkUrl: {
    fontSize: 9,
    color: COLORS.brand,
    textDecoration: "none",
    flex: 1,
  },
});

function PdfInlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((seg, i) => (
        <Text key={i} style={seg.bold ? styles.bold : undefined}>
          {seg.text}
        </Text>
      ))}
    </>
  );
}

function fmtChartPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 8 : 2 })}`;
}

function fmtChartDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Static price/volume chart drawn as native react-pdf SVG (the on-screen chart
// is a cross-origin GeckoTerminal iframe that can't be embedded in a PDF).
// Renders a close-price area+line on top of volume bars. Returns null — omitting
// the whole section — when there aren't at least two points to draw a line.
const CHART_W = 507;
const PRICE_H = 104;
const GAP = 10;
const VOL_H = 30;
const CHART_H = PRICE_H + GAP + VOL_H;

function PriceChart({ points }: { points: ChartPoint[] }) {
  if (!points || points.length < 2) return null;

  const prices = points.map((p) => p.c);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const spanP = maxP - minP || Math.abs(maxP) || 1;
  const maxV = Math.max(...points.map((p) => p.v), 0) || 1;
  const n = points.length;

  const xAt = (i: number): number => (i / (n - 1)) * CHART_W;
  const yAt = (price: number): number =>
    PRICE_H - ((price - minP) / spanP) * PRICE_H;

  const linePts = points
    .map((p, i) => `${xAt(i).toFixed(2)},${yAt(p.c).toFixed(2)}`)
    .join(" ");
  const areaPts = `0,${PRICE_H.toFixed(2)} ${linePts} ${CHART_W.toFixed(2)},${PRICE_H.toFixed(2)}`;

  const up = points[n - 1]!.c >= points[0]!.c;
  const lineColor = up ? COLORS.ok : COLORS.bad;
  const fillColor = up ? "#ecfdf5" : "#fef2f2";

  const volTop = PRICE_H + GAP;
  const barW = Math.max(1, (CHART_W / n) * 0.6);

  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>price · usd · via coingecko</Text>
      <View style={styles.chartMetaRow}>
        <Text style={styles.chartMeta}>high {fmtChartPrice(maxP)}</Text>
        <Text style={styles.chartMeta}>low {fmtChartPrice(minP)}</Text>
      </View>
      <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
        <Polygon points={areaPts} fill={fillColor} />
        <Polyline
          points={linePts}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.5}
        />
        {points.map((p, i) => {
          const h = Math.max(0.5, (p.v / maxV) * VOL_H);
          return (
            <Rect
              key={i}
              x={(xAt(i) - barW / 2).toFixed(2)}
              y={(volTop + (VOL_H - h)).toFixed(2)}
              width={barW.toFixed(2)}
              height={h.toFixed(2)}
              fill={COLORS.line}
            />
          );
        })}
      </Svg>
      <View style={styles.chartDatesRow}>
        <Text style={styles.chartMeta}>{fmtChartDay(points[0]!.t)}</Text>
        <Text style={styles.chartMeta}>{fmtChartDay(points[n - 1]!.t)}</Text>
      </View>
    </View>
  );
}

function statRows(t: ReportData["token"]): { label: string; value: string }[] {
  return [
    { label: "price", value: fmtUsd(t.usdPrice) },
    { label: "market cap", value: fmtUsd(t.marketCap, true) },
    { label: "liquidity", value: fmtUsd(t.liquidityUsd, true) },
    { label: "24h onchain volume", value: fmtUsd(t.totalVolume24h, true) },
    { label: "holders", value: fmtNum(t.holders) },
    { label: "1h change", value: fmtPct(t.pricePercentChange1h) },
    { label: "24h change", value: fmtPct(t.pricePercentChange24h) },
    { label: "age", value: fmtAge(t.createdAt) },
  ];
}

function ReportDocument({ data }: { data: ReportData }) {
  const { token, security, analysis, generatedAt } = data;
  const blocks = parseMarkdown(analysis);
  const secItems = security ? deriveSecurityItems(security) : [];
  const stamp = generatedAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Document
      title={`${token.symbol || "token"} research brief`}
      author="bunnyOS"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Image src={logoUrl} style={styles.logo} />
            <Text style={styles.kicker}>token research brief · base</Text>
          </View>
          <View>
            <Text style={styles.tokenName}>
              {(token.symbol || "?") + (token.name ? `  ·  ${token.name}` : "")}
            </Text>
            <Text style={styles.tokenSub}>generated {stamp}</Text>
            <Text style={styles.addr}>{token.tokenAddress}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>market snapshot</Text>
        <View style={styles.statGrid}>
          {statRows(token).map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={styles.statValue}>{s.value}</Text>
            </View>
          ))}
        </View>

        <PriceChart points={data.chart} />

        {secItems.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>contract security · via goplus</Text>
            <View style={styles.secGrid}>
              {secItems.map((it) => (
                <View key={it.label} style={styles.secItem}>
                  <Text style={styles.secLabel}>{it.label}</Text>
                  <Text style={[styles.secValue, { color: TONE_COLOR[it.tone] }]}>
                    {it.value}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>analysis</Text>
        <View style={styles.divider} />
        {blocks.map((b, i) => {
          if (b.type === "heading") {
            return (
              <Text key={i} style={styles.heading}>
                <PdfInlines inlines={b.inlines} />
              </Text>
            );
          }
          if (b.type === "list") {
            return (
              <View key={i}>
                {b.items.map((item, j) => (
                  <View key={j} style={styles.listRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.listText}>
                      <PdfInlines inlines={item} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          }
          return (
            <Text key={i} style={styles.paragraph}>
              <PdfInlines inlines={b.inlines} />
            </Text>
          );
        })}

        <View style={styles.links} wrap={false}>
          <Text style={styles.linksEyebrow}>About</Text>
          <Image src={logoUrl} style={styles.linksLogo} />
          <Text style={styles.linksTagline}>
            The first free & open source @base agent.
          </Text>
          {REPORT_LINKS.map((l) => (
            <View key={l.url} style={styles.linkRow}>
              <Text style={styles.linkLabel}>{l.label}</Text>
              <Link src={l.url} style={styles.linkUrl}>
                {l.display}
              </Link>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerLine} />
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              data: coingecko · security: goplus · bunnyos.ai
            </Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) =>
                `page ${pageNumber} / ${totalPages}`
              }
            />
          </View>
          <Text style={styles.disclaimer}>
            generated by bunnyOS for informational purposes only. not financial
            advice. crypto assets are volatile and high risk — do your own
            research before transacting.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function fileName(data: ReportData): string {
  const sym = (data.token.symbol || "token").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const d = data.generatedAt ?? new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `bunnyos-${sym || "token"}-report-${stamp}.pdf`;
}

export async function generateReportBlob(data: ReportData): Promise<Blob> {
  return pdf(<ReportDocument data={data} />).toBlob();
}

export async function downloadReportPdf(data: ReportData): Promise<void> {
  const blob = await generateReportBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(data);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Shares the PDF via the native share sheet where supported (file sharing).
// Returns false if the platform can't share files, so the caller can fall back
// to download.
export async function shareReportPdf(data: ReportData): Promise<boolean> {
  const blob = await generateReportBlob(data);
  const file = new File([blob], fileName(data), { type: "application/pdf" });
  const nav = navigator as Navigator & {
    canShare?: (d: ShareData) => boolean;
    share?: (d: ShareData) => Promise<void>;
  };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: `${data.token.symbol || "token"} research brief`,
        text: `bunnyOS research brief for ${data.token.symbol || data.token.tokenAddress}`,
      });
      return true;
    } catch (err) {
      // User cancelled the share sheet — treat as handled, don't fall back.
      if (err instanceof DOMException && err.name === "AbortError") return true;
      return false;
    }
  }
  return false;
}
