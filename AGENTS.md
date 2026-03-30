# Repository Guidelines

## Project Structure & Module Organization

This repository combines a Rust backend with a TypeScript CLI and Web UI.

- `crates/cc-gw-core`: shared Rust core logic for config, routing, storage, protocol conversion, and observability.
- `crates/cc-gw-server`: Axum-based gateway server and HTTP routes.
- `src/cli`: `cc-gw` CLI wrapper built with TypeScript.
- `src/web`: React + Vite Web console.
- `tests/playwright`: end-to-end and visual regression coverage.
- `scripts`: packaging, native bundling, smoke checks, and screenshot utilities.
- `docs`: system design, packaging notes, release checklists, and UI audits.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies.
- `pnpm dev`: run the Rust gateway in local development mode.
- `pnpm build`: build the release server, CLI bundle, Web UI, and native binary package.
- `pnpm typecheck`: run TypeScript checks for `src/cli` and `src/web`.
- `cargo test`: run Rust unit and integration tests.
- `pnpm test:e2e:web`: run the full Playwright suite after a fresh build.
- `pnpm test:e2e:web:update-snapshots`: refresh visual baselines after intentional UI changes.
- `pnpm smoke:cli`: validate the packaged CLI flow.

## Coding Style & Naming Conventions

- Rust uses `cargo fmt` defaults; keep modules focused and prefer explicit types at API boundaries.
- TypeScript uses 2-space indentation, semicolon-free style, and named exports where practical.
- React files use `PascalCase.tsx`; hooks use `useXxx.ts`; shared helpers use `camelCase.ts`.
- Keep API payload fields aligned with existing camelCase Web contracts and Rust `serde` renames.

## Testing Guidelines

- Add Rust tests near the relevant module for protocol, storage, and metrics behavior.
- Add Playwright coverage for user-facing flows in `tests/playwright/*.spec.ts`.
- Update visual snapshots only when the UI change is intentional and reviewed.
- Prefer focused test runs during development, for example: `cargo test api_status_reports_live_and_recent_client_activity` or `pnpm exec playwright test tests/playwright/dashboard.spec.ts`.

## Commit & Pull Request Guidelines

- Follow the existing commit style: `fix: ...`, `feat: ...`, `chore: ...`, `release: ...`.
- Keep commit subjects short, imperative, and scoped to one change.
- PRs should describe backend and UI impact, list verification steps, and link related issues.
- Include screenshots for visible Web UI changes and note any snapshot updates.
