/**
 * Cost formatting (billing, v0.16). Costs are query-time estimates in the
 * configured display currency; `null` means "no price matched" and renders
 * as an em dash — never as 0.
 */
/** Fraction digits by magnitude: ≥10000 → 0, ≥1 → 2, <1 → 4. */
function fractionDigits(value: number): number {
  const abs = Math.abs(value)
  if (abs >= 10_000) return 0
  if (abs >= 1) return 2
  return 4
}

/** `formatCost(2.5, 'CNY')` → `¥2.5`; null/undefined → `—`. Missing currency
 * (overview not yet loaded / fetch failed) renders a symbol-less number rather
 * than guessing a currency the backend never reported. */
export function formatCost(
  value: number | null | undefined,
  currency: string | null | undefined
): string {
  if (value === null || value === undefined) return '—'
  const digits = fractionDigits(value)
  if (currency !== 'USD' && currency !== 'CNY') {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    })
  }
  try {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits
    })
  } catch {
    return `${value.toFixed(digits)} ${currency}`
  }
}
