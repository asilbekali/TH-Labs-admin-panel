/**
 * Activity feed.
 *
 * The TH-LABS API has no audit-log endpoint — nothing in the spec records who
 * did what, or when. So rather than show an empty page, this derives a feed
 * from the timestamps that *are* exposed: account registrations, admin account
 * creations, and wait list signups.
 *
 * The consequence worth knowing: this shows things that HAPPENED to records,
 * not actions ADMINS TOOK. Deletions leave no trace, edits are invisible
 * (nothing returns an updatedAt reliably), and logins aren't recorded at all.
 *
 * When the backend grows a real log endpoint, implement it as another source
 * that returns ActivityEvent[] and add it in `buildActivity` — the UI needs no
 * changes.
 */

import { toDate } from './format'
import type { Admin, ApiUser, WaitListEntry } from './types'

export type ActivityKind = 'user_signup' | 'admin_created' | 'waitlist_joined'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  title: string
  subtitle?: string
  timestamp: Date
  /** Set when the event points at a user record we can link to. */
  userId?: number | string
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  user_signup: 'User signups',
  admin_created: 'Admin accounts',
  waitlist_joined: 'Wait list joins',
}

export function buildActivity(sources: {
  users?: ApiUser[]
  admins?: Admin[]
  waitList?: WaitListEntry[]
}): ActivityEvent[] {
  const events: ActivityEvent[] = []

  for (const u of sources.users ?? []) {
    const ts = toDate(u.createdAt)
    if (!ts) continue
    events.push({
      id: `user-${u.id}`,
      kind: 'user_signup',
      title: `${u.name || u.email} registered`,
      subtitle: `${u.email} · ${u.role}`,
      timestamp: ts,
      userId: u.id,
    })
  }

  for (const a of sources.admins ?? []) {
    const ts = toDate(a.createdAt)
    if (!ts) continue
    events.push({
      id: `admin-${a.id}`,
      kind: 'admin_created',
      title: `Admin account created for ${a.name || a.email}`,
      subtitle: `${a.email} · ${a.role}`,
      timestamp: ts,
    })
  }

  for (const w of sources.waitList ?? []) {
    const ts = toDate(w.createdAt)
    if (!ts) continue
    events.push({
      id: `waitlist-${w.id}`,
      kind: 'waitlist_joined',
      title: `${w.userName || w.email} joined the wait list`,
      subtitle: String(w.email ?? ''),
      timestamp: ts,
    })
  }

  return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}

/** Inclusive lower bound in days; 0 means "everything". */
export function withinDays(event: ActivityEvent, days: number): boolean {
  if (!days) return true
  return event.timestamp.getTime() >= Date.now() - days * 86_400_000
}
