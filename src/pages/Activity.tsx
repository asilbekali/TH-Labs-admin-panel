import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { useQuery } from '../lib/useApi'
import { formatDateTime, relativeTime } from '../lib/format'
import {
  ACTIVITY_LABELS,
  buildActivity,
  withinDays,
  type ActivityKind,
} from '../lib/activity'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, ErrorState, InfoNote, TableSkeleton } from '../components/ui'
import {
  IconList,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUserPlus,
} from '../components/icons'

const KIND_STYLE: Record<ActivityKind, { icon: typeof IconUserPlus; className: string }> = {
  user_signup: { icon: IconUserPlus, className: 'stat-icon' },
  admin_created: { icon: IconShield, className: 'stat-icon violet' },
  waitlist_joined: { icon: IconList, className: 'stat-icon green' },
}

const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time', days: 0 },
]

export function Activity() {
  const { isSuperAdmin } = useAuth()

  const users = useQuery((signal) => endpoints.users(signal))
  const waitList = useQuery((signal) => endpoints.waitList(signal))
  // /v1/admin is SUPERADMIN-only — an ADMIN would 403, so skip the call.
  const admins = useQuery(
    async (signal) => (isSuperAdmin ? endpoints.admins(signal) : []),
    [isSuperAdmin],
  )

  const [kinds, setKinds] = useState<Set<ActivityKind>>(
    () => new Set(Object.keys(ACTIVITY_LABELS) as ActivityKind[]),
  )
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)

  const events = useMemo(
    () =>
      buildActivity({
        users: users.data ?? [],
        admins: admins.data ?? [],
        waitList: waitList.data ?? [],
      }),
    [users.data, admins.data, waitList.data],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (!kinds.has(e.kind)) return false
      if (!withinDays(e, days)) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) || (e.subtitle ?? '').toLowerCase().includes(q)
      )
    })
  }, [events, kinds, days, search])

  const loading = users.initialLoading || waitList.initialLoading || admins.initialLoading
  const error = users.error || waitList.error || admins.error

  function refetchAll() {
    users.refetch()
    waitList.refetch()
    admins.refetch()
  }

  function toggleKind(kind: ActivityKind) {
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const visible = filtered.slice(0, limit)

  return (
    <>
      <p className="page-intro">
        A chronological feed of account and wait list activity across the platform.
      </p>

      <InfoNote title="Derived feed — the API has no audit log" tone="warn">
        There is no logging endpoint in the TH-LABS API, so this timeline is reconstructed from the
        <code> createdAt</code> timestamps on user, admin and wait list records. It shows{' '}
        <strong>records being created</strong>, not actions administrators took — deletions, edits
        and logins leave no trace to display. Wiring a real audit endpoint into{' '}
        <code>src/lib/activity.ts</code> would light this page up without UI changes.
      </InfoNote>

      <div className="toolbar" style={{ marginTop: 18 }}>
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search activity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="select"
          style={{ width: 'auto' }}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Time range"
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>

        {(Object.keys(ACTIVITY_LABELS) as ActivityKind[]).map((kind) => (
          <button
            key={kind}
            className={`btn btn-sm${kinds.has(kind) ? ' btn-primary' : ''}`}
            onClick={() => toggleKind(kind)}
            aria-pressed={kinds.has(kind)}
          >
            {ACTIVITY_LABELS[kind]}
          </button>
        ))}

        <div className="spacer" />
        <button className="btn" onClick={refetchAll} disabled={loading}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      {error && <ErrorState error={error} onRetry={refetchAll} />}

      {loading ? (
        <TableSkeleton rows={8} cols={3} />
      ) : (
        !error && (
          <div className="card">
            {visible.length ? (
              <div className="feed">
                {visible.map((event) => {
                  const { icon: Icon, className } = KIND_STYLE[event.kind]
                  const row = (
                    <>
                      <div className={`feed-icon ${className}`}>
                        <Icon />
                      </div>
                      <div className="feed-body">
                        <div className="feed-title">{event.title}</div>
                        {event.subtitle && <div className="feed-meta">{event.subtitle}</div>}
                      </div>
                      <div className="feed-time" title={formatDateTime(event.timestamp)}>
                        {relativeTime(event.timestamp)}
                      </div>
                    </>
                  )

                  return event.userId != null ? (
                    <Link key={event.id} className="feed-item" to={`/users/${event.userId}`}>
                      {row}
                    </Link>
                  ) : (
                    <div key={event.id} className="feed-item">
                      {row}
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                title="No activity in this range"
                message="Widen the time range or clear the filters."
              />
            )}

            {filtered.length > visible.length && (
              <div className="pagination">
                <span>
                  Showing {visible.length} of {filtered.length}
                </span>
                <div className="spacer" />
                <button className="btn btn-sm" onClick={() => setLimit((n) => n + 50)}>
                  Load more
                </button>
              </div>
            )}
          </div>
        )
      )}
    </>
  )
}
