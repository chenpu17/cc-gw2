# Rust Backend Migration Plan

## Compatibility Targets

- Keep config path and format compatible with `~/.cc-gw/config.json`
- Keep SQLite path and schema compatible with `~/.cc-gw/data/gateway.db`
- Keep CLI verbs compatible with `cc-gw start|stop|restart|status`
- Keep Web UI unchanged and continue serving it from `/ui`
- Preserve Anthropic and OpenAI-compatible HTTP surface as migration completes

## Current Status

- Rust server workspace is in place and buildable
- Web frontend and Node CLI wrapper both remain buildable
- Config bootstrap, SQLite bootstrap, and legacy schema backfill are implemented
- Static Web UI serving is implemented
- Control-plane routes now implemented:
  - config read/write
  - web auth read/write and session login/logout
  - provider listing and provider connection test
  - custom endpoint CRUD
  - routing preset create/apply/delete
  - events list
  - API key CRUD / reveal / usage metrics
  - logs list/detail/export/cleanup/clear
  - DB info / compact
  - stats overview / daily / model / api keys
- Data-plane routes now implemented:
  - `/v1/messages`
  - `/v1/messages/count_tokens`
  - `/openai/v1/models`
  - `/openai/v1/chat/completions`
  - `/openai/v1/responses`
- Cross-protocol conversion implemented for:
  - OpenAI Chat -> Anthropic
  - Anthropic -> OpenAI Chat
  - Anthropic -> OpenAI Responses
- Request logging, events, API key auth, payload storage, and daily aggregations are implemented
- Streaming requests now record status, full latency, usage, TTFT, TPOT, and response payloads
- Dynamic custom endpoint proxying is implemented instead of config-only placeholders

## Next Milestones

1. Streaming parity
   - improve OpenAI Responses source stream -> Anthropic compatibility
   - refine tool-call / tool-result incremental event handling
   - close remaining SSE edge cases and error-path behavior

2. Provider diagnostics
   - improve `/api/providers/{id}/test` to match old Node diagnostics more closely
   - align returned detail fields and failure classification

3. Packaging
   - prebuilt native binary layout
   - npm publish flow with bundled Rust executable
   - release automation for macOS/Linux

4. Verification
   - expand end-to-end regression coverage against legacy config/database fixtures
   - verify frontend behavior on the Rust backend for all admin flows

## Recommended Order

Prioritize remaining streaming protocol parity first, then provider diagnostics, then packaging/release automation. The Web UI control plane is already largely usable on top of the Rust backend.
