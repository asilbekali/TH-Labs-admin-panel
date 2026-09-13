/**
 * Vercel Web Analytics plumbing.
 *
 * The React <Analytics /> component reports whatever is in the address bar.
 * For this panel that is a problem on both counts:
 *
 *  - `/users/412` and `/users/9` are *the same page*, but they arrive as two
 *    distinct rows, so the one page every admin uses looks like a long tail of
 *    single-visit URLs.
 *  - Those ids identify real customer records. Normalising them away means the
 *    analytics provider is told a user detail page was opened, not whose.
 *
 * So the path is rewritten to its route pattern before anything is sent.
 */

import type { BeforeSendEvent } from '@vercel/analytics/react'

/** Matches a path segment that is an opaque record id rather than a route. */
const ID_SEGMENT = /^\d+$/

/**
 * Collapse dynamic segments to their route pattern:
 * `/users/412` -> `/users/[id]`.
 */
export function normalizeAnalyticsPath(pathname: string): string {
  return (
    pathname
      .split('/')
      .map((segment) => (ID_SEGMENT.test(segment) ? '[id]' : segment))
      .join('/') || '/'
  )
}

/**
 * Rewrite an event's URL to the normalized path, dropping the query string and
 * hash. No route in this app carries state in either, so anything that shows up
 * there is noise at best.
 *
 * Returning the event (rather than null) keeps the pageview — only its URL
 * changes. A malformed URL is dropped instead of reported raw.
 */
export function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url)
    url.search = ''
    url.hash = ''
    url.pathname = normalizeAnalyticsPath(url.pathname)
    return { ...event, url: url.toString() }
  } catch {
    return null
  }
}
