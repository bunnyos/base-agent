# Changelog

All notable changes to Base Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-01

### Added
- **Token Explorer** — search any token for live market data and on-chain activity, with GoPlus security/risk signals, exportable as a formatted PDF report.
- **GoPlus Labs token security** — token risk checks (honeypot, taxes, ownership, and more) surfaced to the agent and in the Token Explorer. No API key required.
- **CoinGecko integration** — a single market-data source covering CEX quotes, listings and metadata plus on-chain DEX pairs (via the GeckoTerminal proxy). Uses a free per-user CoinGecko Demo key.
- **PDF reports** — export token research as a formatted PDF.
- **Native actions** — a starter pack of actions shipped in code and seeded per user; workflows now distinguish `native` (code-owned) from `custom` (user-authored).
- **Token references on alerts/recommendations** — action rows now carry the tokens they mention (symbol + contract address), surfaced in the UI as "tokens mentioned".

### Changed
- **Replaced CoinMarketCap with CoinGecko** as the market-data provider; the consolidated CoinGecko library also absorbs the former DexScreener and GeckoTerminal usage. Legacy tool names are migrated automatically on server start.
- **Database schema** — added `actions.tokens` and `workflows.source`; renamed `user_settings.cmc_api_key` → `coingecko_api_key`. Apply with `pnpm --filter @workspace/db run push`.
- Regenerated the OpenAPI spec and the generated zod / React Query clients.

### Removed
- The CoinMarketCap integration (superseded by CoinGecko).

### Fixed
- **Local development now matches the README out of the box** — the API server defaults to port `3000` and the interface to `5173`, the Vite dev server proxies `/api` → `:3000`, and the repo-root `.env` is auto-loaded (via Node `--env-file` / `process.loadEnvFile`). `cp .env.example .env` followed by the documented dev commands now works without manually exporting variables.

## [0.1.0] - 2026-05-29

### Added
- Initial public release — the first open-source [Base](https://base.org) agent, built on [Base MCP](https://mcp.base.org). Self-hostable and AGPL-3.0 licensed.
- Four core systems: autonomous **action scanners** (alerts and one-click recommendations), a tabbed **terminal UI**, markdown-based **memory**, and a native **MCP & tooling** layer.
- First-party tool sources: Base account MCP, Moralis, CoinMarketCap, DeFi Llama, Bankr, and Morpho.
- Security model: no private keys on the system (execution is approved in the Base app); stored API keys and wallet tokens encrypted at rest (AES-256-GCM), with HMAC-signed sessions.

[Unreleased]: https://github.com/bunnyos/base-agent/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bunnyos/base-agent/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bunnyos/base-agent/releases/tag/v0.1.0
