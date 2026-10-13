/**
 * Cost formatting (billing, v0.16). Costs are query-time estimates in the
 * configured display currency; `null` means "no price matched" and renders
 * as an em dash — never as 0.
 */
export type CostCurrency = 'CNY' | 'USD'

/** Fraction digits by magnitude: ≥10000 → 0, ≥1 → 2, <1 → 4. */
function fractionDigits(value: number): number {
  const abs = Math.abs(value)
  if (abs >= 10_000) return 0
  if (abs >= 1) return 2
  return 4
}

/** `formatCost(2.5, 'CNY')` → `¥2.5`; null/undefined → `—`. */
export function formatCost(
  value: number | null | undefined,
  currency: string | null | undefined
): string {
  if (value === null || value === undefined) return '—'
  const code: CostCurrency = currency === 'USD' ? 'USD' : 'CNY'
  const digits = fractionDigits(value)
  try {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits
    })
  } catch {
    return `${value.toFixed(digits)} ${code}`
  }
}
