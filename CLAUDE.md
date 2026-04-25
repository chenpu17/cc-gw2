# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-gw2 is a Rust-backed local AI gateway proxy (compatible with Claude Code / Anthropic / OpenAI APIs) with a React web console and a Node.js CLI. It proxies API requests to configured providers with model routing, API key management, cross-protocol conversion, request logging, and a profiler.

## Build & Development Commands

```bash
# Backend (Rust) - run dev server
cargo run -p cc-gw-server

# Backend - run Rust tests
cargo test

# Backend - release build
cargo build --release -p cc-gw-server

# Frontend (React) - dev server
cd src/web && pnpm dev

# Frontend - build
pnpm --filter @cc-gw/web build

# CLI - build
pnpm --filter @cc-gw/cli build

# Full build (backend + CLI + web + native bundle)
pnpm build

# Run Rust unit test for a specific module
cargo test -p cc-gw-core api_keys
cargo test -p cc-gw-server proxy_routes

# Typecheck all TypeScript
pnpm typecheck

# E2E tests (Playwright, requires full build first)
pnpm test:e2e:web:core

# Dry-run npm pack
pnpm pack:dry-run
```

## Architecture

### Dual-Language Monorepo

- **Rust workspace** (`crates/`): Backend server and core logic
  - `cc-gw-core`: Shared library — API key management, config, routing, protocol conversion, streaming, observability, storage/migrations, profiling
  - `cc-gw-server`: Axum HTTP server — proxy routes, admin API, web auth, profiler routes, UI static serving
- **pnpm workspace** (`src/`, `packages/`): Frontend and tooling
  - `src/web/`: React + Vite + Tailwind web console (SPA served at `/ui`)
  - `src/cli/`: Node.js CLI entry point (`cc-gw` binary)
  - `packages/native/*`: Platform-specific Rust binary wrappers for npm distribution

### Request Flow

1. Incoming request hits proxy routes (`/v1/messages`, `/openai/v1/chat/completions`, or custom endpoint paths)
2. `authorize_request_with_context()` resolves the API key via `resolve_api_key()` (checks hash, wildcard, enabled status, allowed endpoints)
3. `resolve_route()` selects provider + model based on endpoint routing config, model routes (with wildcard pattern support), aliases, and fallback chain (model routes → direct match → thinking default → long-context default → completion default → global fallback)
4. `build_request_body_for_target()` converts between Anthropic/OpenAI protocols if cross-protocol routing is needed
5. `forward_request()` sends to the upstream provider; response is proxied back with usage stats extraction and optional stream transformation
6. Request logs, daily metrics, and API key usage are recorded in SQLite

### Key Design Patterns

- **Config**: `~/.cc-gw/config.json` (JSON), hot-reloaded via `RwLock<GatewayConfig>`. Config is validated on update and atomically saved.
- **Database**: SQLite at `~/.cc-gw/data/gateway.db`. Schema uses incremental migrations via `maybe_add_column()`. WAL mode enabled.
- **API Key Auth**: Keys are SHA-256 hashed for storage, AES-256-GCM encrypted for the ciphertext column. One wildcard key is auto-created. Auth supports bearer token and x-api-key header.
- **Streaming**: SSE streams are observed by `SseStreamObserver` for usage stats; `CrossProtocolStreamTransformer` handles real-time Anthropic↔OpenAI conversion. `RequestActivityGuard` (RAII) tracks active requests per endpoint/IP/session.
- **Protocol Conversion**: Bidirectional conversion between Anthropic Messages API and OpenAI Chat Completions / Responses API in `crates/cc-gw-core/src/convert.rs`.
- **Routing**: Model alias resolution (e.g., `claude-sonnet-latest` → concrete version), wildcard pattern matching in model routes, and per-endpoint routing overrides via `custom_endpoints`.

### Frontend

- React 18 + React Router + TanStack Query + i18next
- UI components: Radix UI primitives + Tailwind CSS + shadcn-style patterns (`src/web/src/components/ui/`)
- Charts: ECharts via echarts-for-react
- API calls go through `src/web/src/services/` using axios

### Database Tables (core)

- `request_logs` — per-request telemetry with session/IP/endpoint/tokens/latency
- `request_payloads` — optional request/response body storage (BLOB)
- `daily_metrics` — aggregated per-date-per-endpoint stats (composite PK: date + endpoint)
- `api_keys` — key hash, encrypted ciphertext, allowed endpoints, usage counters
- `api_key_audit_logs` — audit trail for key CRUD
- `gateway_events` — system event log
- `profiler_sessions` / `profiler_turns` — per-session profiling data

## Configuration

- Data directory: `~/.cc-gw/` (overridable via `CC_GW_HOME` env var)
- Server port: 4100 (overridable via `PORT` env var)
- HTTP body limit: 10MB default
- Logging: `RUST_LOG` env var (default: `cc_gw_server=info,axum=info`)

## CI

GitHub Actions runs on push/PR: Rust tests, full build, Playwright E2E (core + hardening), CLI smoke test, and npm pack verification.
