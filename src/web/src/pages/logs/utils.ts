export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')} ${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}:${`${date.getSeconds()}`.padStart(2, '0')}`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return value.toLocaleString()
}

export function formatLatency(value: number | null | undefined, suffix: string): string {
  const formatted = formatNumber(value)
  return formatted === '-' ? '-' : `${formatted} ${suffix}`
}

export function formatStreamLabel(stream: boolean): string {
  return stream ? 'true' : 'false'
}

export function formatPayloadDisplay(value: string | null | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback
  }
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return value
  }
}
