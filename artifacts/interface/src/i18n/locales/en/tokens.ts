export default {
  contractSecurity: "contract security",
  viaGoplus: "via goplus",

  rateLimitReached:
    "rate limit reached — wait a bit before generating more reports.",
  reportEndedEarly:
    "report ended early — connection dropped before it finished. try again.",
  pdfGenerateError: "could not generate pdf — try again.",
  pdfShareError: "could not share pdf — try again.",

  generatedAt: "generated {time}",
  generating: "generating…",
  downloadPdf: "download pdf",
  share: "share",
  shareReport: "share report",
  buy: "buy",
  closeReport: "close report",
  chartTitle: "{symbol} chart",

  errorPrefix: "error",
  failedToGenerateReport: "failed to generate report",
  generatingReport: "generating report…",
  writing: "writing…",

  stat24hOnchainVol: "24h onchain vol",

  loadingSharedReport: "loading shared report…",
  couldntLoadReport: "couldn't load this token's report",
  notBaseTokenOrUnavailable:
    "it may not be a base token, or its data is unavailable.",

  methodologyMoralisTitle: "Trending tokens",
  methodologyMoralisSource: "Moralis trending-tokens API (chain: base).",
  methodologyMoralisFilters:
    "Surfaces tokens with recent traction. List cached ~1h.",
  methodologyMoralisMarket:
    "Price, market cap, liquidity and % change come from Moralis. Volume is the token's aggregate 24h onchain (dex) volume across all pools — it excludes cex trading.",

  methodologyVirtualsTitle: "Graduated AI-agent tokens",
  methodologyVirtualsSource:
    "virtuals.io API (status=AVAILABLE, sorted by 24h volume — most actively traded first, any age).",
  methodologyVirtualsFilters:
    "Only graduated/tradeable tokens. Dead pairs hidden (< $10 24h volume). List cached ~1h.",
  methodologyVirtualsMarket:
    "Price, market cap, liquidity and % change come from CoinGecko via each token's top onchain pool. Volume is the token's aggregate 24h onchain (dex) volume across all pools — it excludes cex trading. Name, logo and holder count come from virtuals.",

  methodologyBankrTitle: "Recent launches",
  methodologyBankrSource: "Bankr recent-token-launches API (base).",
  methodologyBankrFilters:
    "Dead pairs hidden (< $10 24h volume). List cached ~1h.",
  methodologyBankrMarket:
    "Price, market cap, liquidity and % change come from CoinGecko via each launch's top onchain pool. Volume is the token's aggregate 24h onchain (dex) volume across all pools — it excludes cex trading.",

  researchBase: "research · base",
  dataMethodology: "data methodology",
  sourceLabel: "source:",
  filtersLabel: "filters:",
  marketDataLabel: "market data:",

  subtitleBankr:
    "recent launches via bankr — click a token for a fresh ai report",
  subtitleVirtuals:
    "ai agent tokens via virtuals — click a token for a fresh ai report",
  subtitleMoralis:
    "trending via moralis — click a token for a fresh ai report",

  refresh: "refresh",

  filterMinLiq: "min liq $",
  filterMin24hVol: "min 24h vol $",
  filterMinMktCap: "min mkt cap $",
  filterMinHolders: "min holders",
  filterMaxAge: "max age (d)",
  filterMin1h: "min 1h %",
  filterMin24h: "min 24h %",
  clearFilters: "clear filters →",

  loadingRecentLaunches: "loading recent launches…",
  loadingVirtualsTokens: "loading virtuals tokens…",
  loadingTrendingTokens: "loading trending tokens…",

  failedToLoadTokens: "failed to load tokens",

  noTokensMatchFilters: "no tokens match your filters.",
  noRecentLaunches: "no recent launches right now.",
  noVirtualsTokens: "no virtuals tokens right now.",
  noTrendingTokens: "no trending tokens right now.",

  colToken: "token",
  colPrice: "price",
  colMktCap: "mkt cap",
  colLiquidity: "liquidity",
  col24hVol: "24h vol",
  col1h: "1h",
  col24h: "24h",
  colHolders: "holders",
  colAge: "age",

  buyCommand: "buy 1 USDC of {address}",
} as const;
