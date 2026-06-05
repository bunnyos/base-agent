export default {
  contractSecurity: "合约安全",
  viaGoplus: "数据来自 GoPlus",

  rateLimitReached: "已达速率限制 — 稍等片刻再生成更多报告。",
  reportEndedEarly: "报告中断 — 连接在完成前断开。请重试。",
  pdfGenerateError: "无法生成 PDF — 请重试。",
  pdfShareError: "无法分享 PDF — 请重试。",

  generatedAt: "生成于 {time}",
  generating: "生成中…",
  downloadPdf: "下载 PDF",
  share: "分享",
  shareReport: "分享报告",
  buy: "买入",
  closeReport: "关闭报告",
  chartTitle: "{symbol} 图表",

  errorPrefix: "错误",
  failedToGenerateReport: "报告生成失败",
  generatingReport: "生成报告中…",
  writing: "撰写中…",

  stat24hOnchainVol: "24h 链上交易量",

  loadingSharedReport: "加载分享报告中…",
  couldntLoadReport: "无法加载该代币的报告",
  notBaseTokenOrUnavailable: "它可能不是 Base 代币，或数据暂不可用。",

  methodologyMoralisTitle: "热门代币",
  methodologyMoralisSource: "Moralis 热门代币 API（链：base）。",
  methodologyMoralisFilters: "呈现近期有热度的代币。列表缓存约 1 小时。",
  methodologyMoralisMarket:
    "价格、市值、流动性与涨跌幅来自 Moralis。交易量为该代币在所有池子的 24h 链上（DEX）总量 — 不含 CEX 交易。",

  methodologyVirtualsTitle: "已毕业的 AI 智能体代币",
  methodologyVirtualsSource:
    "virtuals.io API（status=AVAILABLE，按 24h 交易量排序 — 交易最活跃者优先，不限年龄）。",
  methodologyVirtualsFilters:
    "仅含已毕业/可交易代币。隐藏无效交易对（24h 交易量 < $10）。列表缓存约 1 小时。",
  methodologyVirtualsMarket:
    "价格、市值、流动性与涨跌幅来自 CoinGecko，取自各代币的头部链上池。交易量为该代币在所有池子的 24h 链上（DEX）总量 — 不含 CEX 交易。名称、Logo 与持有人数来自 virtuals。",

  methodologyBankrTitle: "近期发行",
  methodologyBankrSource: "Bankr 近期代币发行 API（base）。",
  methodologyBankrFilters: "隐藏无效交易对（24h 交易量 < $10）。列表缓存约 1 小时。",
  methodologyBankrMarket:
    "价格、市值、流动性与涨跌幅来自 CoinGecko，取自各发行的头部链上池。交易量为该代币在所有池子的 24h 链上（DEX）总量 — 不含 CEX 交易。",

  researchBase: "研究 · Base",
  dataMethodology: "数据方法论",
  sourceLabel: "来源：",
  filtersLabel: "筛选：",
  marketDataLabel: "市场数据：",

  subtitleBankr: "近期发行（来自 bankr）— 点击代币获取最新 AI 报告",
  subtitleVirtuals: "AI 智能体代币（来自 virtuals）— 点击代币获取最新 AI 报告",
  subtitleMoralis: "热门趋势（来自 moralis）— 点击代币获取最新 AI 报告",

  refresh: "刷新",

  filterMinLiq: "最小流动性 $",
  filterMin24hVol: "最小 24h 交易量 $",
  filterMinMktCap: "最小市值 $",
  filterMinHolders: "最少持有人",
  filterMaxAge: "最大年龄（天）",
  filterMin1h: "最小 1h %",
  filterMin24h: "最小 24h %",
  clearFilters: "清除筛选 →",

  loadingRecentLaunches: "加载近期发行中…",
  loadingVirtualsTokens: "加载 virtuals 代币中…",
  loadingTrendingTokens: "加载热门代币中…",

  failedToLoadTokens: "代币加载失败",

  noTokensMatchFilters: "没有符合筛选条件的代币。",
  noRecentLaunches: "暂无近期发行。",
  noVirtualsTokens: "暂无 virtuals 代币。",
  noTrendingTokens: "暂无热门代币。",

  colToken: "代币",
  colPrice: "价格",
  colMktCap: "市值",
  colLiquidity: "流动性",
  col24hVol: "24h 量",
  col1h: "1h",
  col24h: "24h",
  colHolders: "持有人",
  colAge: "年龄",

  buyCommand: "买入 1 USDC 的 {address}",
} as const;
