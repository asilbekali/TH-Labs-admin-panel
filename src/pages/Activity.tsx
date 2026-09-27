import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  API_BASE,
  ApiError,
  endpoints,
  isForbidden,
  isMissingRoute,
  isWrongApiBase,
  streamLogs,
} from '../lib/api'
import { useQuery } from '../lib/useApi'
import { formatDateTime, relativeTime } from '../lib/format'
import type { LogQuery, LogRow } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import {
  Badge,
  EmptyState,
  ErrorState,
  ForbiddenNote,
  InfoNote,
  MissingRouteNote,
  Pagination,
  TableSkeleton,
  WrongApiBaseNote,
} from '../components/ui'
import { IconChevron, IconRefresh, IconSearch, IconX } from '../components/icons'

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

interface Filters {
  q: string
  action: string
  method: string
  success: '' | 'true' | 'false'
  actorId: string
  targetLabel: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = {
  q: '',
  action: '',
  method: '',
  success: '',
  actorId: '',
  targetLabel: '',
  from: '',
  to: '',
}

function hasFilters(f: Filters): boolean {
  return Object.values(f).some((v) => v !== '')
}

export function Activity() {
  const { user } = useAuth()

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [live, setLive] = useState(true)

  // Rows that arrived over the stream since the last fetch. Only used on page
  // one with no filters — see onLiveRow below.
  const [liveRows, setLiveRows] = useState<LogRow[]>([])
  const [pendingCount, setPendingCount] = useState(0)

  const query: LogQuery = useMemo(
    () => ({
      page,
      limit,
      q: filters.q || undefined,
      action: filters.action || undefined,
      method: filters.method || undefined,
      success: filters.success === '' ? undefined : filters.success === 'true',
      actorId: filters.actorId || undefined,
      targetLabel: filters.targetLabel || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [page, limit, filters],
  )

  const logs = useQuery((signal) => endpoints.logs(query, signal), [query])
  const actions = useQuery((signal) => endpoints.logActions(signal))

  const filtered = hasFilters(filters)
  const canStream = live && page === 1

  const refresh = useCallback(() => {
    setLiveRows([])
    setPendingCount(0)
    logs.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.refetch])

  // A fresh fetch supersedes anything the stream had buffered.
  useEffect(() => {
    setLiveRows([])
    setPendingCount(0)
  }, [query])

  /**
   * An unfiltered page one can take stream rows straight to the top. Under a
   * filter it cannot — the server decides what matches, and guessing here
   * would quietly show rows the filter excludes — so those are counted and the
   * operator is offered a refresh instead.
   */
  const onLiveRow = useCallback(
    (row: LogRow) => {
      if (filtered) {
        setPendingCount((n) => n + 1)
        return
      }
      setLiveRows((rows) => (rows.some((r) => r.id === row.id) ? rows : [row, ...rows].slice(0, 200)))
    },
    [filtered],
  )

  const streamState = useLogStream(canStream, onLiveRow, refresh)

  const rows = useMemo(() => {
    const fetched = logs.data?.rows ?? []
    if (!liveRows.length) return fetched
    const seen = new Set(fetched.map((r) => r.id))
    return [...liveRows.filter((r) => !seen.has(r.id)), ...fetched]
  }, [logs.data, liveRows])

  const total = logs.data?.total ?? rows.length
  const pageCount = Math.max(Math.ceil(total / limit), 1)

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  // `actions` is the reliable probe — see isMissingRoute. When it 404s the
  // whole logs controller is absent, whatever /admin/logs itself answered.
  //
  // The three cases below look identical from the feed (no rows) and have
  // nothing in common as fixes, so each says which one it is. Order matters:
  // a wrong base URL 404s everything, so it has to be ruled out before the
  // 404 can be read as "this build has no logs".
  const blocker = actions.error ?? logs.error

  if (isWrongApiBase(blocker) || isMissingRoute(blocker) || isForbidden(blocker)) {
    return (
      <>
        <p className="page-intro">Who did what, to whom, and whether it worked.</p>

        {isWrongApiBase(blocker) ? (
          <WrongApiBaseNote
            url={blocker instanceof ApiError ? blocker.url : undefined}
            base={API_BASE}
          />
        ) : isForbidden(blocker) ? (
          <ForbiddenNote what="activity log" role={user?.role} />
        ) : (
          <MissingRouteNote
            what="activity log"
            routes={['/v1/admin/logs', '/v1/admin/logs/actions']}
          />
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={logs.refetch}>
            <IconRefresh />
            Try again
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <p className="page-intro">
        Who did what, to whom, and whether it worked. Rows are append-only — nothing can edit or
        delete one, and reading the log is not itself logged.
      </p>

      {/* ------------------------------ filters ----------------------------- */}
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search summary, path, action, actor or target email…"
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
          />
        </div>

        <select
          className="select"
          style={{ width: 'auto' }}
          value={filters.action}
          onChange={(e) => setFilter('action', e.target.value)}
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {(actions.data ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ width: 'auto' }}
          value={filters.method}
          onChange={(e) => setFilter('method', e.target.value)}
          aria-label="Filter by method"
        >
          <option value="">Any method</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className="spacer" />

        <button className="btn" onClick={refresh} disabled={logs.loading}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      {/* --------------------------- quick filters -------------------------- */}
      <div className="chip-row">
        <button
          className={`chip${filters.success === 'false' ? ' on' : ''}`}
          onClick={() => setFilter('success', filters.success === 'false' ? '' : 'false')}
        >
          Failures only
        </button>
        <button
          className={`chip${filters.actorId === String(user?.id) ? ' on' : ''}`}
          onClick={() =>
            setFilter('actorId', filters.actorId === String(user?.id) ? '' : String(user?.id ?? ''))
          }
        >
          My actions
        </button>

        <input
          className="input chip-input"
          placeholder="This account (target email)…"
          value={filters.targetLabel}
          onChange={(e) => setFilter('targetLabel', e.target.value)}
        />

        <label className="chip-date">
          From
          <input
            className="input"
            type="date"
            value={filters.from}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </label>
        <label className="chip-date">
          To
          <input
            className="input"
            type="date"
            value={filters.to}
            onChange={(e) => setFilter('to', e.target.value)}
          />
        </label>

        {filtered && (
          <button className="chip clear" onClick={() => setFilters(EMPTY_FILTERS)}>
            <IconX />
            Clear filters
          </button>
        )}

        <div className="spacer" />

        <label className="check">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live
        </label>
        <StreamBadge state={streamState} enabled={canStream} />
      </div>

      {live && page > 1 && (
        <InfoNote title="Live updates pause past page one">
          New events would reshuffle the page you are reading. Go back to page one to resume.
        </InfoNote>
      )}

      {pendingCount > 0 && (
        <button className="new-events" onClick={refresh}>
          {pendingCount} new event{pendingCount === 1 ? '' : 's'} — refresh to apply your filters
        </button>
      )}

      {logs.error && <ErrorState error={logs.error} onRetry={logs.refetch} />}

      {/* ------------------------------- feed ------------------------------- */}
      {logs.initialLoading ? (
        <TableSkeleton rows={10} cols={3} />
      ) : (
        !logs.error && (
          <div className="card">
            {rows.length ? (
              <div className="feed">
                {rows.map((row) => (
                  <LogEntry key={row.id} row={row} onFilterActor={(id) => setFilter('actorId', String(id))} />
                ))}
              </div>
            ) : (
              <EmptyState
                title={filtered ? 'No events match these filters' : 'No activity recorded yet'}
                message={filtered ? 'Widen the date range or clear the filters.' : undefined}
              />
            )}

            {total > 0 && (
              <Pagination
                page={page}
                pageCount={pageCount}
                total={total}
                pageSize={limit}
                onPage={setPage}
                onPageSize={(n) => {
                  // The server caps limit at 200.
                  setLimit(Math.min(n, 200))
                  setPage(1)
                }}
              />
            )}
          </div>
        )
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* One row                                                                     */
/* -------------------------------------------------------------------------- */

function LogEntry({ row, onFilterActor }: { row: LogRow; onFilterActor: (id: number) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`feed-item log${row.success ? '' : ' failed'}`}>
      <button
        className="log-main"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`log-marker${row.success ? '' : ' failed'}`} />

        <span className="feed-body">
          <span className="feed-title">
            <span className="log-actor">{row.actorEmail ?? 'system'}</span>
            <span className="log-dash"> — </span>
            {row.summary}
          </span>
          <span className="feed-meta">
            <code>{row.action}</code>
            <span className="text-faint">
              {row.method} {row.path} · {row.statusCode} · {row.durationMs}ms
            </span>
            {row.targetLabel && (
              <span className="text-faint">
                → {row.targetType}: {row.targetLabel}
              </span>
            )}
          </span>
        </span>

        <span className="feed-time" title={formatDateTime(row.createdAt)}>
          {relativeTime(row.createdAt)}
        </span>
        <span className={`log-caret${open ? ' open' : ''}`}>
          <IconChevron />
        </span>
      </button>

      {open && (
        <div className="log-detail">
          <div className="prop-grid">
            <Detail label="Actor">
              {row.actorEmail ?? 'system'}
              {row.actorRole && <Badge>{row.actorRole}</Badge>}
              {row.actorId != null && (
                <button className="link-btn" onClick={() => onFilterActor(row.actorId as number)}>
                  filter to this admin
                </button>
              )}
            </Detail>
            <Detail label="Target">
              {row.targetLabel ?? '—'}
              {row.targetType && <span className="text-faint"> ({row.targetType})</span>}
              {row.targetId && <span className="mono text-faint"> #{row.targetId}</span>}
            </Detail>
            <Detail label="Result">
              <Badge tone={row.success ? 'green' : 'red'}>
                {row.success ? 'success' : 'failed'} · {row.statusCode}
              </Badge>
            </Detail>
            <Detail label="When">{formatDateTime(row.createdAt)}</Detail>
            <Detail label="IP">{row.ip ?? '—'}</Detail>
            <Detail label="User agent">
              <span className="truncate" title={row.userAgent ?? ''}>
                {row.userAgent ?? '—'}
              </span>
            </Detail>
          </div>

          {row.meta && Object.keys(row.meta).length > 0 && (
            <>
              <div className="log-detail-label">
                Request detail <span className="text-faint">— secrets already redacted</span>
              </div>
              <pre className="code-block">{JSON.stringify(row.meta, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop">
      <div className="prop-key">{label}</div>
      <div className="prop-val detail-val">{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Live updates                                                                */
/* -------------------------------------------------------------------------- */

type StreamState = 'connecting' | 'streaming' | 'polling' | 'off'

/**
 * Live log updates.
 *
 * `EventSource` cannot set an Authorization header, and the brief rules out
 * putting the token in the query string, so the stream is read with fetch
 * instead. If that fails for any reason — including an API build with no
 * /admin/logs/stream at all — this falls back to polling and says so, rather
 * than going quietly dead.
 */
function useLogStream(
  enabled: boolean,
  onRow: (row: LogRow) => void,
  onPoll: () => void,
): StreamState {
  const [state, setState] = useState<StreamState>(enabled ? 'connecting' : 'off')

  // Reset when live mode is toggled. Done during render — React's documented
  // way to adjust state from a changed prop — so the effect below is left to
  // do only what an effect is for: subscribing to an external system.
  const [wasEnabled, setWasEnabled] = useState(enabled)
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled)
    setState(enabled ? 'connecting' : 'off')
  }

  // Held in refs so a changing callback identity doesn't tear the stream down
  // and rebuild it on every render.
  const onRowRef = useRef(onRow)
  const onPollRef = useRef(onPoll)
  useEffect(() => {
    onRowRef.current = onRow
    onPollRef.current = onPoll
  })

  useEffect(() => {
    if (!enabled) return

    let pollTimer: ReturnType<typeof setInterval> | null = null

    const stop = streamLogs(
      (row) => {
        setState('streaming')
        onRowRef.current(row)
      },
      () => {
        // The stream could not be established or dropped out. Poll instead.
        setState('polling')
        if (!pollTimer) {
          pollTimer = setInterval(() => onPollRef.current(), 5000)
        }
      },
    )

    return () => {
      stop()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [enabled])

  return state
}

function StreamBadge({ state, enabled }: { state: StreamState; enabled: boolean }) {
  if (!enabled) return null

  const label: Record<StreamState, string> = {
    connecting: 'connecting…',
    streaming: 'live',
    polling: 'polling every 5s',
    off: '',
  }
  const tone = state === 'streaming' ? 'green' : state === 'polling' ? 'amber' : ''

  return (
    <Badge tone={tone}>
      <span className="dot" />
      {label[state]}
    </Badge>
  )
}
