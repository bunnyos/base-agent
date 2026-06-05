export default {
  contractSecurity: "컨트랙트 보안",
  viaGoplus: "goplus 제공",

  rateLimitReached:
    "요청 제한에 도달했습니다 — 더 많은 리포트를 생성하기 전에 잠시 기다려 주세요.",
  reportEndedEarly:
    "리포트가 일찍 종료되었습니다 — 완료되기 전에 연결이 끊겼습니다. 다시 시도하세요.",
  pdfGenerateError: "pdf를 생성할 수 없습니다 — 다시 시도하세요.",
  pdfShareError: "pdf를 공유할 수 없습니다 — 다시 시도하세요.",

  generatedAt: "{time} 생성됨",
  generating: "생성 중…",
  downloadPdf: "pdf 다운로드",
  share: "공유",
  shareReport: "리포트 공유",
  buy: "구매",
  closeReport: "리포트 닫기",
  chartTitle: "{symbol} 차트",

  errorPrefix: "오류",
  failedToGenerateReport: "리포트 생성 실패",
  generatingReport: "리포트 생성 중…",
  writing: "작성 중…",

  stat24hOnchainVol: "24시간 온체인 거래량",

  loadingSharedReport: "공유된 리포트 불러오는 중…",
  couldntLoadReport: "이 토큰의 리포트를 불러올 수 없습니다",
  notBaseTokenOrUnavailable:
    "base 토큰이 아니거나 데이터를 사용할 수 없습니다.",

  methodologyMoralisTitle: "인기 토큰",
  methodologyMoralisSource: "Moralis 인기 토큰 API (체인: base).",
  methodologyMoralisFilters:
    "최근 주목받는 토큰을 표시합니다. 목록은 약 1시간 캐시됩니다.",
  methodologyMoralisMarket:
    "가격, 시가총액, 유동성, 변동률은 Moralis에서 가져옵니다. 거래량은 모든 풀에 걸친 토큰의 24시간 온체인(dex) 총거래량이며 cex 거래는 제외합니다.",

  methodologyVirtualsTitle: "그래듀에이트된 AI 에이전트 토큰",
  methodologyVirtualsSource:
    "virtuals.io API (status=AVAILABLE, 24시간 거래량 정렬 — 가장 활발히 거래된 순, 기간 무관).",
  methodologyVirtualsFilters:
    "그래듀에이트/거래 가능한 토큰만. 비활성 페어 숨김(24시간 거래량 < $10). 목록은 약 1시간 캐시됩니다.",
  methodologyVirtualsMarket:
    "가격, 시가총액, 유동성, 변동률은 각 토큰의 최상위 온체인 풀을 통해 CoinGecko에서 가져옵니다. 거래량은 모든 풀에 걸친 토큰의 24시간 온체인(dex) 총거래량이며 cex 거래는 제외합니다. 이름, 로고, 홀더 수는 virtuals에서 가져옵니다.",

  methodologyBankrTitle: "최근 출시",
  methodologyBankrSource: "Bankr 최근 토큰 출시 API (base).",
  methodologyBankrFilters:
    "비활성 페어 숨김(24시간 거래량 < $10). 목록은 약 1시간 캐시됩니다.",
  methodologyBankrMarket:
    "가격, 시가총액, 유동성, 변동률은 각 출시 토큰의 최상위 온체인 풀을 통해 CoinGecko에서 가져옵니다. 거래량은 모든 풀에 걸친 토큰의 24시간 온체인(dex) 총거래량이며 cex 거래는 제외합니다.",

  researchBase: "리서치 · base",
  dataMethodology: "데이터 방법론",
  sourceLabel: "출처:",
  filtersLabel: "필터:",
  marketDataLabel: "시장 데이터:",

  subtitleBankr:
    "bankr를 통한 최근 출시 — 토큰을 클릭하면 새 ai 리포트",
  subtitleVirtuals:
    "virtuals를 통한 ai 에이전트 토큰 — 토큰을 클릭하면 새 ai 리포트",
  subtitleMoralis:
    "moralis를 통한 인기 — 토큰을 클릭하면 새 ai 리포트",

  refresh: "새로고침",

  filterMinLiq: "최소 유동성 $",
  filterMin24hVol: "최소 24시간 거래량 $",
  filterMinMktCap: "최소 시가총액 $",
  filterMinHolders: "최소 홀더 수",
  filterMaxAge: "최대 기간 (일)",
  filterMin1h: "최소 1h %",
  filterMin24h: "최소 24h %",
  clearFilters: "필터 지우기 →",

  loadingRecentLaunches: "최근 출시 불러오는 중…",
  loadingVirtualsTokens: "virtuals 토큰 불러오는 중…",
  loadingTrendingTokens: "인기 토큰 불러오는 중…",

  failedToLoadTokens: "토큰을 불러오지 못했습니다",

  noTokensMatchFilters: "필터에 맞는 토큰이 없습니다.",
  noRecentLaunches: "지금은 최근 출시가 없습니다.",
  noVirtualsTokens: "지금은 virtuals 토큰이 없습니다.",
  noTrendingTokens: "지금은 인기 토큰이 없습니다.",

  colToken: "토큰",
  colPrice: "가격",
  colMktCap: "시가총액",
  colLiquidity: "유동성",
  col24hVol: "24h 거래량",
  col1h: "1h",
  col24h: "24h",
  colHolders: "홀더",
  colAge: "기간",

  buyCommand: "{address} 1 USDC어치 구매",
} as const;
