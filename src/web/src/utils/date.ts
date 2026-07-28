import i18n from '@/i18n'

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp

  const absDiff = Math.abs(diffMs)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  // Locale-aware relative time via the platform Intl API, driven by the active
  // i18n language so zh renders "3 分钟前" and en renders "3 minutes ago".
  const rtf = new Intl.RelativeTimeFormat(i18n.language || 'en', { numeric: 'auto' })

  if (absDiff < minute) {
    const seconds = Math.max(Math.round(absDiff / 1000), 1)
    return rtf.format(diffMs >= 0 ? -seconds : seconds, 'second')
  }
  if (absDiff < hour) {
    const minutes = Math.round(absDiff / minute)
    return rtf.format(diffMs >= 0 ? -minutes : minutes, 'minute')
  }
  if (absDiff < day) {
    const hours = Math.round(absDiff / hour)
    return rtf.format(diffMs >= 0 ? -hours : hours, 'hour')
  }
  const days = Math.round(absDiff / day)
  return rtf.format(diffMs >= 0 ? -days : days, 'day')
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}
