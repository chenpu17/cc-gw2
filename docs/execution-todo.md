# Execution Todo

## Done

- [x] Rust backend scaffold and server workspace
- [x] Legacy config and SQLite compatibility bootstrap
- [x] Web UI static hosting
- [x] Web Auth session flow and `/api/*` protection
- [x] API key CRUD / reveal / usage metrics
- [x] Events, logs, export, cleanup, and DB admin endpoints
- [x] Dynamic custom endpoint routing and proxying
- [x] Custom endpoint requests now retain their own endpoint id for auth, logs, and API key stats
- [x] Streaming request logging with usage, TTFT, TPOT, and payload persistence
- [x] Provider test query/header passthrough and text/credential failure compatibility
- [x] Automated regression baseline for provider test, streaming observation, config save, and SQLite migration
- [x] End-to-end coverage for Web Auth, custom endpoints, and API key admin/reveal/stats
- [x] OpenAI Responses -> Anthropic SSE stop-reason and tool-output fallback coverage
- [x] npm prebuilt binary packaging and local release-flow documentation
- [x] prepack build hook, CLI smoke script, and GitHub Actions CI verification
- [x] Playwright Web UI e2e coverage for page navigation, theme/language switchers, and API key workflow
