---
name: modernist-webui
description: Bootstrap or enforce the "Modernist" web UI design system — sharp corners (radius 0), a single red accent, no-green status colors (success = dark gray), zero shadows, Archivo 800 headings, restrained flat fills (no glass / no gradients). For React + Tailwind v3 + shadcn/ui projects. Invoke when starting a new web app's UI, adding pages/components to an existing Modernist app, or auditing/polishing visual consistency. Invoke by name when the user says "modernist", "用我们的 webui 设计", or asks to make a UI match the cc-gw2 console look.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# Modernist Web UI — Design System

A portable, opinionated **visual** design system extracted from the cc-gw2 web console.
Tech-agnostic at the token layer; components assume React + Tailwind v3 + shadcn/ui.

> Source of truth in this repo: `src/web/src/styles/global.css` (tokens) +
> `src/web/tailwind.config.cjs` (mapping). The `global.css` and
> `tailwind.config.snippet.cjs` sitting next to this SKILL.md are functionally
> identical copies (every token value, selector, and rule matches; comments
> translated to English) — drop them into a new project verbatim.

---

## The Modernist contract (7 non-negotiables)

Every screen in this system obeys these. If a review finds a violation, it's a bug.

1. **Sharp corners.** `--radius: 0px`. Cards, buttons, inputs, dialogs, popovers are all square. The *only* exception is `rounded-full`, reserved for avatars, status dots, and pill toggles.
2. **One accent color — red.** `--primary: #ec3013` (light) / `#ff563c` (dark). Primary, focus ring, selection, links, and chart-1 all derive from it. Never introduce a second hue as an accent.
3. **No green for status.** Success is **dark gray** (`--success: #444141`); warning/error are red-family. Status is conveyed by *weight + red*, never a rainbow. This is intentional — it's the signature of the system.
4. **Zero shadows.** `--surface-shadow: none`. Visual separation comes from 1px `--border` + background contrast (`card` #fff over `background` #f3f2f2). Never `shadow-*`.
5. **No glass, no gradients.** Flat fills only. No `backdrop-blur`, no `linear/radial-gradient`, no frosted panes.
6. **Heavy headings.** Archivo weight **800**, letter-spacing `-0.015em`. Body uses `tabular-nums` so numbers align in tables/metrics.
7. **Subtle motion.** 160ms `surface` easing (`cubic-bezier(0.22, 1, 0.36, 1)`) on transform/border/background. Always honor `prefers-reduced-motion`.

Restraint is the aesthetic. When in doubt, remove the effect rather than add one.

---

## Files to drop into a new project

| Drop-in file | Target path | What it is |
|---|---|---|
| `global.css` (next to this file) | `src/styles/global.css` | `@tailwind` directives + `:root`/`.dark` token layer + base resets (body font, square scrollbar, red focus/selection, motion classes). |
| `tailwind.config.snippet.cjs` | merge `theme.extend` into your config | Maps the CSS vars to Tailwind colors, collapses all radii to `--radius`, adds the `surface` easing + `live-pulse` animation. |

**Prerequisites:** Tailwind v3, the `tailwindcss-animate` plugin, and these fonts loaded — `Archivo` (400/600/800), `Noto Sans SC` / `PingFang SC` (CJK fallback). `darkMode: ['class', '[data-theme="dark"]']`. You also need a `cn()` helper at `@/lib/utils` (`clsx` + `tailwind-merge`) — the standard `shadcn-ui init` scaffolds this; every primitive imports it. The drop-in CSS targets a `#root` mount element — rename it in `global.css` if your app mounts elsewhere (e.g. `#app`).

---

## Token system

### Surface & content
| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#f3f2f2` | `#201e1d` | app canvas |
| `--foreground` | `#201e1d` | `#f8f4f4` | default text |
| `--card` | `#ffffff` | `#2d2b2b` | card fill (`--popover` shares these values) |
| `--secondary` | `#f8f4f4` | `#363333` | inset/neutral fill |
| `--accent` | `#f8f4f4` | `#363333` | shadcn hover fill (not red) |
| `--muted` | `#eae7e7` | `#444141` | muted fill |
| `--muted-foreground` | `#605d5d` | `#d7d3d3` | secondary text |
| `--border` / `--input` | `#d7d3d3` | `#605d5d` | 1px separators |
| `--radius` | `0px` | `0px` | **everything square** |
| `--surface-shadow` | `none` | `none` | **no shadows** |
| `--surface-border` | `#d7d3d3` | `#605d5d` | popover/toast/dropdown border |

### Accent (the only hue)
`--primary` `#ec3013` / `#ff563c` · `--ring` = primary · `--destructive` `#dd2b0f` / `#ff563c`.

### Status — subverted semantics (no green)
| | Light fg / bg | Dark fg / bg | Meaning |
|---|---|---|---|
| `--success` | `#444141` / `#eae7e7` | `#d7d3d3` / `#444141` | OK = dark gray |
| `--warning` | `#ae1800` / `#ffe0d9` | `#ff9783` / `#71261b` | caution = red |
| `--error` | `#dd2b0f` / `#fff2ef` | `#ff563c` / `#7c1405` | failure = red |
| `--info` | `#605d5d` / `#eae7e7` | `#d7d3d3` / `#444141` | folded into neutral |

Use the **two-tier** form: `text-success bg-success-bg`, `text-warning bg-warning-bg`, etc. (the Tailwind config exposes `success.DEFAULT` + `success.bg`).

### Chart palette (mono red + gray)
`--chart-1` red → `--chart-2` deep red → `--chart-3` coral → `--chart-4` gray → `--chart-5` light gray. Five steps, one hue family. See `src/web/src/components/chartTheme.ts` for the ECharts theme.

---

## Typography

- **Headings (`h1–h4`):** Archivo **800**, `letter-spacing: -0.015em`.
- **Body:** Archivo 400/600; `font-variant-numeric: tabular-nums` globally (numbers align in tables/metrics).
- **Metric numbers:** `.metric-number` — Archivo + `tabular-nums` + tighter `-0.02em` tracking (for big KPI values).
- **Eyebrow / label caps:** `text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/78` (small red-all-caps label above a section title).
- **CJK:** `Noto Sans SC` / `PingFang SC` fall back after Archivo — keep them in the font stack so Chinese renders cleanly.

---

## Component conventions

### Base layer — shadcn/ui (23 primitives)
`badge button card command dialog dropdown-menu input label popover scroll-area select separator switch table tabs textarea toast tooltip` + custom `count-up disclosure metric-card segmented-control step-nav`.

Variant discipline:
- **Button:** `default` (primary red), `outline` (borderless, card-filled, neutral), `destructive` (red), `ghost`, `secondary`, `link`. No `rounded-*` overrides.
- **Badge:** `default | secondary | outline | success | warning | destructive | info` (`purple`/`pink` collapse to a primary tint). `success` renders gray with a `live-pulse` dot. Status badges are **never green**.
- **Card:** always via `cardVariants({ variant })`; never add `shadow-*`.

### Custom primitives (the signature pieces)

**`PageSection`** — the universal content container. Card with an optional header:
```
┌─────────────────────────────────────┐
│ EYEBROW (red, caps)        [actions] │
│ Title (h2, semibold)                 │
│ description (muted)                  │
├─────────────────────────────────────┤
│  p-6 content                         │
└─────────────────────────────────────┘
```
Props: `eyebrow / title / description / actions / children`. Header is `flex sm:flex-row sm:justify-between`, content `p-6`. Source: `src/web/src/components/PageSection.tsx`.

**`MetricCard`** — the KPI tile. Sizes `sm|md|lg`. Supports: `value` (with `rawValue`+`format` for **CountUp** animation), `delta` (arrow + invertible color — set `invertColor` when *down is good*, e.g. latency/error rate), `sparkline`, `dotClassName` (status dot), `featured` (subtle primary wash), `hint`. Always pass a pre-formatted `value` fallback so SSR/snapshots have text. Source: `src/web/src/components/ui/metric-card.tsx`.

**`Disclosure`** — collapsible section (variants `plain` default / `card`), used for "infrastructure details" / long secondary data. Summary row + tabular badge on the right; default **collapsed** for low-priority detail. A divider is caller-supplied via `contentClassName="border-t border-border ..."`.

**`DialogShell` / `ConfirmDialog`** — square (`radius 0`) dialogs; destructive confirms use `variant="destructive"`.

**`CommandPalette`** (Cmd/Ctrl+K) — `command`-based; square popover, red selected state.

---

## Layout patterns

- **Card-based, not sidebar-nested.** Each concern is a `PageSection`/Card; the page is a vertical stack of cards on a `#f3f2f2` canvas.
- **Page header:** `PageToolbar` with h1 (`text-base font-semibold`) + actions; sections anchor via `id="section-<name>"` for in-page nav.
- **Grids:** responsive `grid gap-4 lg:grid-cols-2` (or `sm:grid-cols-2 lg:grid-cols-4` for metric rows). Use `MiniInfoCard` for compact centered label/value readouts.
- **Collapsible detail** → `Disclosure`, collapsed by default, with a tabular badge (`dbSize · mem`) on the summary.
- **Dense data** → `table` + `tabular-nums`; volatile values masked with `[data-visual-volatile]` for visual tests.

---

## Motion & a11y

- Surface transitions: `transition duration-160 ease-surface` (the config exposes `duration-160` + `ease-surface`). Or use the `.motion-surface` class (defined in `global.css`) which bundles the property allowlist (transform/box-shadow/border-color/background-color/color) + duration + easing — `MetricCard`/`StepNav` use it. Either way: only transform/border/bg/color, never layout thrash.
- `animate-fade-in`: defined **twice** and that's intentional — `global.css` ships a plain-CSS `.animate-fade-in` (keyframes `fadeIn`) that wins the cascade; the Tailwind config's `fade-in` utility is shadowed. Both do opacity 0→1 in 0.2s, so it's harmless; just use `.animate-fade-in` and don't expect to retheme it via Tailwind.
- Live indicators: `animate-live-pulse` (2.4s breathing dot) for "online / listening / RPM" status only.
- Focus: `ring-2 ring-primary ring-offset-2 ring-offset-background` — red, always visible.
- Touch: coarse pointers get `min-height: 44px` on all interactive elements (in base CSS).
- Reduced motion: a base-CSS media query zeroes all animation/transition durations.

---

## How to apply this to a new project

1. **Drop tokens:** copy `global.css` → `src/styles/global.css`; import it once at the app entry. Merge `tailwind.config.snippet.cjs` → your Tailwind config. Load Archivo + Noto Sans SC.
2. **Install the base:** `shadcn/ui` init, then add the primitives listed above. Set `darkMode: ['class','[data-theme="dark"]']`.
3. **Port the 3 signature primitives:** `PageSection`, `MetricCard` (with `CountUp`), `Disclosure` — copy from this repo's `src/web/src/components/`.
4. **Build the first screen** as a stack of `PageSection` cards on the neutral canvas; KPIs as `MetricCard`; secondary detail as collapsed `Disclosure`.
5. **Audit against the contract:** the 7 non-negotiables above. Red flags to grep for: literal `shadow-sm/md/lg/xl`, `backdrop-blur`, `background: .*gradient`, `green-`, `emerald-`, and any `rounded-[Npx]` override that bypasses `--radius`.
   **Mind the false positives:** `shadow-[var(--surface-shadow*)]` resolves to `none` (inert), and bare `rounded-{lg,xl,md,sm}` are collapsed to `--radius: 0px` by the Tailwind config — neither renders. Only flag shadow/rounded classes with a *literal* size or an inline override.

## Anti-patterns (hard no)

- `rounded-[Npx]` overrides on cards/buttons/dialogs → must be square (bare `rounded-lg` etc. are fine; the config zeroes them).
- Literal `shadow-sm/md/lg/xl` → use border + contrast instead (`shadow-[var(--surface-shadow)]` is allowed — it's `none`).
- Green/`emerald` success badges → use `secondary` (gray) or `text-success`.
- CSS gradients / glass on UI surfaces, frosted sidebars, `backdrop-blur`. (Gradients inside an SVG **logo asset** are exempt.)
- A second accent hue (blue/purple buttons, multicolor charts beyond the 5-step palette).
- Decorative motion beyond 160ms surface transitions.

> **Scope:** this contract governs the console app (`src/web/src/`, mounted at `#root`). The marketing landing page (`src/web/src/landing/`, a separate entry point on `#landing-root`) has its own rounded aesthetic and is intentionally exempt.

---

## Reference (in this repo)

- Tokens: `src/web/src/styles/global.css` · Tailwind map: `src/web/tailwind.config.cjs`
- Primitives: `src/web/src/components/{PageSection,PageToolbar,PageState}.tsx`, `src/web/src/components/ui/{metric-card,disclosure,count-up,card,button,badge}.tsx`
- Chart theme: `src/web/src/components/chartTheme.ts` · Live copy-paste files: alongside this SKILL.md.
