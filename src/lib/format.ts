/** Display helpers. All of them tolerate undefined — API responses are loose. */

export function formatDate(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "3 days ago" / "in 2 hours". Falls back to an absolute date past a month. */
export function relativeTime(value: unknown): string {
  const d = toDate(value)
  if (!d) return '—'

  const diffMs = d.getTime() - Date.now()
  const abs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day

  if (abs < minute) return rtf.format(Math.round(diffMs / 1000), 'second')
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute')
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour')
  if (abs < week) return rtf.format(Math.round(diffMs / day), 'day')
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / week), 'week')
  return formatDate(d)
}

/** True when `value` is a timestamp inside the last `days` days. */
export function isWithinDays(value: unknown, days: number): boolean {
  const d = toDate(value)
  if (!d) return false
  return d.getTime() >= Date.now() - days * 86_400_000
}

export function formatCents(cents: unknown): string {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—'
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  return value.toLocaleString()
}

/** Turns `stripePriceId` into "Stripe price id" for generic field rendering. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Renders an arbitrary JSON value as a single readable line. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    // ISO timestamps are far more useful rendered as dates.
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+/.test(value)) return formatDateTime(value)
    return value
  }
  if (typeof value === 'number') return formatNumber(value)
  return JSON.stringify(value)
}

export function initialsOf(name: unknown, email?: unknown): string {
  const source = typeof name === 'string' && name.trim() ? name : String(email ?? '?')
  const parts = source.trim().split(/[\s@._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
