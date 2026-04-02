# Dashboard Spotlight Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the dashboard spotlight so the left side becomes a compact overview panel and the right side becomes a uniform eight-card metrics grid.

**Architecture:** Keep the existing `DashboardSpotlight` entry point and metric formatting helpers, but change the JSX structure so runtime information merges into the left summary column and the right metrics use a strict grid. Protect the behavior with Playwright assertions that fail if the old runtime strip returns or the eight metrics stop rendering as a single uniform group.

**Tech Stack:** React, TypeScript, Tailwind CSS, Playwright, Vite

---

### Task 1: Add regression assertions for the approved spotlight structure

**Files:**
- Modify: `tests/playwright/dashboard.spec.ts`
- Test: `tests/playwright/dashboard.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
  await expect(page.getByTestId('dashboard-runtime-strip')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-overview-panel')).toBeVisible()
  await expect(page.getByTestId('dashboard-runtime-address')).toContainText('127.0.0.1:')
  await expect(page.getByTestId('dashboard-spotlight-grid')).toBeVisible()
  await expect(page.locator('[data-testid^="dashboard-spotlight-value-"]')).toHaveCount(8)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec playwright test tests/playwright/dashboard.spec.ts --reporter=line`
Expected: FAIL because `dashboard-runtime-strip` still exists and the new overview hooks are missing.

- [ ] **Step 3: Keep the rest of the scenario intact**

```ts
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await expect(page.getByText('最新请求')).toBeVisible()
  await expect(page.getByText('今日请求数')).toBeVisible()
```

- [ ] **Step 4: Re-run the same test after edits are in place**

Run: `pnpm exec playwright test tests/playwright/dashboard.spec.ts --reporter=line`
Expected: PASS

### Task 2: Rebuild the spotlight layout in the dashboard page

**Files:**
- Modify: `src/web/src/pages/dashboard/DashboardSections.tsx`
- Test: `tests/playwright/dashboard.spec.ts`

- [ ] **Step 1: Replace the old split layout with a tighter two-column hero**

```tsx
        <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)] xl:items-stretch">
```

- [ ] **Step 2: Merge runtime identity into the left overview panel**

```tsx
            <div
              className="flex h-full flex-col justify-between rounded-[28px] border border-border/70 bg-background/30 p-5"
              data-testid="dashboard-overview-panel"
            >
```

```tsx
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Gateway runtime
                  </p>
                  <p
                    className="mt-2 text-[clamp(1.2rem,1rem+0.8vw,1.9rem)] font-semibold text-foreground"
                    data-testid="dashboard-runtime-address"
                  >
                    {(status?.host ?? '0.0.0.0')}:{status?.port ?? '-'}
                  </p>
                </div>
```

- [ ] **Step 3: Move the supporting runtime facts into the left column as secondary metadata**

```tsx
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoMetric ... />
              </div>
```

- [ ] **Step 4: Remove the old lower runtime strip entirely**

```tsx
          {/* remove dashboard-runtime-strip block */}
```

- [ ] **Step 5: Make the right-side metric grid uniform**

```tsx
            <div
              className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-4"
              data-testid="dashboard-spotlight-grid"
            >
```

```tsx
    <div className="flex h-full min-w-0 flex-col rounded-2xl border border-border/80 bg-background/75 px-4 py-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.45)] backdrop-blur">
```

- [ ] **Step 6: Keep values resilient while aligning cards visually**

```tsx
      <MetricValueDisplay parts={parts} testId={valueTestId} compact={false} />
```

- [ ] **Step 7: Preserve existing formatting helpers and avoid unrelated restructuring**

```tsx
function splitMetricValue(value: string) {
  // keep helper behavior unchanged unless required for card layout
}
```

### Task 3: Rebuild and verify the dashboard and visual baseline

**Files:**
- Modify: `tests/playwright/visual.spec.ts-snapshots/dashboard-page-darwin.png` (only if snapshot changes intentionally)
- Test: `tests/playwright/dashboard.spec.ts`
- Test: `tests/playwright/pages.spec.ts`
- Test: `tests/playwright/visual.spec.ts`

- [ ] **Step 1: Run the focused dashboard regression**

Run: `pnpm exec playwright test tests/playwright/dashboard.spec.ts --reporter=line`
Expected: PASS

- [ ] **Step 2: Run the page shell regression**

Run: `pnpm exec playwright test tests/playwright/pages.spec.ts -g "web console pages load and navigation works" --reporter=line`
Expected: PASS

- [ ] **Step 3: Refresh the dashboard screenshot baseline if the visual diff is intentional**

Run: `pnpm exec playwright test tests/playwright/visual.spec.ts -g "dashboard visual shell stays aligned with redesign baseline" --update-snapshots --reporter=line`
Expected: PASS and update only the dashboard snapshot if the new layout is approved.

- [ ] **Step 4: Run the dashboard visual regression on the new baseline**

Run: `pnpm exec playwright test tests/playwright/visual.spec.ts -g "dashboard visual shell stays aligned with redesign baseline" --reporter=line`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-02-dashboard-spotlight-layout-design.md \
  docs/superpowers/plans/2026-04-02-dashboard-spotlight-layout.md \
  src/web/src/pages/dashboard/DashboardSections.tsx \
  tests/playwright/dashboard.spec.ts \
  tests/playwright/visual.spec.ts-snapshots/dashboard-page-darwin.png
git commit -m "feat: refine dashboard spotlight layout"
```
