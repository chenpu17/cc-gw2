# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-gw2 (npm package `@chenpu17/cc-gw`, CLI binary `cc-gw`) is a Rust-backed local-first AI gateway proxy compatible with Claude Code / Anthropic / OpenAI APIs. It has a React web console (served at `/ui`, product landing site at `/`) and a Node.js CLI. It proxies API requests to configured providers with model routing, API key management, cross-protocol conversion, request logging, and event/metrics dashboards. The Rust backend replaced an older Node.js server; external behavior, `~/.cc-gw` paths, SQLite data, and key/encryption formats stay backward compatible.

`AGENTS.md` holds repo conventions (naming, commit style) and also applies here.

## Build & Development Commands

```bash
pnpm install                # install workspace deps
pnpm dev                    # run Rust gateway in dev (cargo run -p cc-gw-server)
pnpm build                  # full: Rust release + CLI + web + native binary bundle
pnpm typecheck              # tsc --noEmit for src/cli and src/web

cargo test                                        # all Rust tests
cargo test -p cc-gw-core api_keys                 # one module's tests
cargo test api_status_reports_live_and_recent     # a single test by name

cd src/web && pnpm dev                            # web console dev server (Vite)
pnpm --filter @cc-gw/cli exec tsx index.ts start --foreground   # run CLI from source
```

Web has **no unit test runner** — all frontend coverage is Playwright E2E.

```bash
pnpm test:e2e:web:core                             # behavior suites (needs pnpm build first; scripts do it)
pnpm test:e2e:web:hardening                        # low-frequency/dangerous-path suite
pnpm test:e2e:web:visual                           # visual regression (darwin-local baselines)
pnpm exec playwright test tests/playwright/dashboard.spec.ts    # one spec file
pnpm test:e2e:web:update-snapshots                 # refresh visual baselines (only for intentional UI changes)
pnpm smoke:cli                                     # packaged CLI smoke flow
pnpm pack:dry-run                                  # verify npm packaging
```

First E2E run needs `pnpm exec playwright install --with-deps chromium`.

## Architecture

### Dual-Language Monorepo

- **Rust workspace** (`crates/`): backend server and all core logic
  - `cc-gw-core`: config, routing, protocol conversion (`convert.rs`), streaming (`stream.rs`), storage/migrations (`storage.rs`), API keys, events, observability, provider/model types
  - `cc-gw-server`: Axum HTTP server — route modules: `proxy_routes` (the proxy path), `admin_routes` (`/api/*`), `auth_routes`/`auth.rs` (web console login), `dashboard_routes`, `ui_routes` (SPA + landing static serving), `web_middleware`
- **pnpm workspace**: 
  - `src/web/`: React 18 + Vite + Tailwind web console. Pages under `src/web/src/pages/`; `pages/workbench` is the provider/routing workbench at `/providers` (the old `/models` + `/routing` pages redirect here); `pages/setup` is the cold-start wizard.
  - `src/cli/`: Node.js CLI (`start`/`stop`/`restart`/`status`/`version`); resolves the Rust binary via platform native npm package → `CC_GW_SERVER_BIN` → `bin/<platform>-<arch>/` → `target/release|debug` → `cargo run` fallback chain.
  - `packages/native/*`: platform-specific Rust binary wrapper packages for npm distribution (darwin-arm64, linux-x64/arm64 musl, win32-x64 static CRT).

### Request Flow

1. Incoming request hits proxy routes (`/v1/messages`, `/openai/v1/chat/completions`, `/v1/responses`, or custom endpoint paths from `custom_endpoints`).
2. `authorize_request_with_context()` resolves the API key via `resolve_api_key()` (hash lookup, wildcard, enabled status, allowed endpoints).
3. `resolve_route()` selects provider + model. Fallback chain: model routes (exact/wildcard, via aliases) → direct model match against providers → thinking/reasoning default → long-context default (token estimate vs `long_context_threshold`) → completion default → global fallback (`enable_routing_fallback`). `resolve_route_with_reason()` powers the admin "hit simulation" endpoint.
4. `build_request_body_for_target()` converts between Anthropic/OpenAI protocols when cross-protocol routing is needed.
5. `forward_request()` sends to the upstream provider; the response is proxied back with usage-stats extraction and optional stream transformation.
6. Request logs, daily metrics, API key usage, and events are recorded in SQLite.

### Key Design Patterns

- **Config**: `~/.cc-gw/config.json`, hot-reloaded via `RwLock<GatewayConfig>`; validated on update, atomically saved.
- **Database**: SQLite at `~/.cc-gw/data/gateway.db`, WAL mode; schema evolves via incremental `maybe_add_column()`-style migrations; must stay readable by older versions.
- **API Key Auth**: SHA-256 hash column + AES-256-GCM ciphertext column; one wildcard key auto-created; bearer token and `x-api-key` header both accepted. Legacy `encryption.key`, key ciphertext, and scrypt web-auth password formats must keep working.
- **Streaming**: `SseStreamObserver` (core `stream.rs`) watches SSE for usage stats; `CrossProtocolStreamTransformer` does real-time Anthropic↔OpenAI conversion. `RequestActivityGuard` (RAII, in server `proxy_routes.rs`) tracks active requests per endpoint/IP/session.
- **Protocol Conversion**: bidirectional Anthropic Messages ↔ OpenAI Chat Completions / Responses in `cc-gw-core/src/convert.rs`.

### Frontend Conventions

- **Design system is "Modernist"** (sharp corners, single red accent, no shadows/gradients): enforced by the `modernist-webui` skill (`.claude/skills/modernist-webui/`); token source of truth is `src/web/src/styles/global.css` + `src/web/tailwind.config.cjs`. Any UI work must conform — invoke the skill when adding/polishing UI.
- **i18n**: messages split per feature in `src/web/src/i18n/locales/{zh,en}/<feature>.ts` — update **both** locales together. English plurals use i18next `_one`/`_other` key suffixes (e.g. `routeCount_one`), never `{one, other}` object form.
- **API layer**: `src/web/src/services/` (axios) + TanStack Query hooks (`useApiQuery`, `useAppMutation`). Error handling uses `toApiError(error).message` — not `instanceof Error`.
- UI component primitives: Radix UI + shadcn-style components in `src/web/src/components/ui/`; charts via echarts-for-react.

### E2E Test Architecture

- `tests/playwright/harness.ts` spawns the **built Rust binary** (`target/release` → `target/debug`) with an isolated temp `CC_GW_HOME`, a free port, and a built-in stub upstream provider — tests never touch the developer's real `~/.cc-gw`.
- Playwright projects: `desktop-zh` is canonical and runs every spec; `desktop-en`/`narrow-zh`/`narrow-en` only match `visual*.spec.ts`. Tags `@overlay-only` and `@data` run exclusively under `desktop-zh`.
- Visual baselines are darwin-local artifacts (CI never compares them); snapshot filenames encode the project name.

### Database Tables (core)

- `request_logs` — per-request telemetry (session/IP/endpoint/tokens/latency)
- `request_payloads` — optional request/response body storage (BLOB)
- `daily_metrics` — per-date-per-endpoint aggregates (composite PK: date + endpoint)
- `api_keys` — key hash, encrypted ciphertext, allowed endpoints, usage counters
- `api_key_audit_logs` — key CRUD audit trail
- `gateway_events` — system event log

Authoritative schema doc: `docs/database-schema.md`; API compatibility matrix: `docs/api-compatibility.md`; system design: `docs/system-design.md`.

## Configuration

- Data directory: `~/.cc-gw/` (override with `CC_GW_HOME`)
- Server port: 4100 (override with `PORT`)
- Logging: `RUST_LOG` (default `cc_gw_server=info,axum=info`)
- Version check (used by stub/CLI): `CC_GW_VERSION_CHECK_REGISTRY_BASE_URL`, `CC_GW_VERSION_CHECK_PACKAGE_NAME`

## Conventions

- Commit style: `fix: …`, `feat: …`, `chore: …`, `release: …` — short imperative subjects, one change per commit. Keep API payload fields camelCase to match existing Web contracts and Rust `serde` renames.
- Rust: `cargo fmt` defaults; TypeScript: 2-space, no semicolons; React files `PascalCase.tsx`, hooks `useXxx.ts`.

## CI

GitHub Actions (`.github/workflows/ci.yml`, `release.yml`): Rust tests, full build, Playwright E2E (core + hardening), CLI smoke test, npm pack verification; release pipeline publishes the root package + 4 platform native packages.
