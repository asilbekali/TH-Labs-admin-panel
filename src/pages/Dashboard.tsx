import { useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, ApiError, endpoints, isMissingRoute, isWrongApiBase } from '../lib/api'
import { useQuery } from '../lib/useApi'
import { useFeedbackInbox } from '../lib/feedbackInbox'
import { formatDateTime, formatNumber, isWithinDays, relativeTime } from '../lib/format'
import { KIND_TONE, STATUS_TONE, UNTRIAGED, type FeedbackKind, type FeedbackStatus } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { BillingStatus } from '../components/BillingStatus'
import {
  BarChart,
  Badge,
  EmptyState,
  ErrorState,
  InfoNote,
  WrongApiBaseNote,
} from '../components/ui'
import { IconCard, IconList, IconMessage, IconPulse, IconUsers } from '../components/icons'

/** The stats window the dashboard chart covers. */
const WINDOW_HOURS = 24

export function Dashboard() {
  const { user } = useAuth()

  const overview = useQuery((signal) => endpoints.billingOverview(signal))
  const users = useQuery((signal) => endpoints.users(signal))
  const community = useQuery((signal) => endpoints.community(signal))

  // Pinned once per mount: recomputing this on every render would give the
  // query a new key each time and refetch the chart in a loop.
  const [from] = useState(() => new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString())
  const stats = useQuery((signal) => endpoints.logStats({ bucket: 'hour', from }, signal), [from])
  const recent = useQuery((signal) => endpoints.logs({ limit: 8 }, signal))

  // Newest first is the API's own order for the inbox, so an unfiltered first
  // page is already "the latest five".
  const feedback = useQuery((signal) => endpoints.feedback({ limit: 5 }, signal))
  const untriaged = useFeedbackInbox()

  const userRows = users.data ?? []
  const newThisWeek = userRows.filter((u) => isWithinDays(u.createdAt, 7)).length

  // The first error that proves the panel is not reaching the API at all. Every
  // query on this page fails the same way when that happens, so one is enough.
  const misrouted = [overview.error, users.error, stats.error, recent.error, feedback.error].find(
    isWrongApiBase,
  )

  return (
    <>
      <p className="page-intro">
        Welcome back, {user?.name?.split(' ')[0] || user?.email}. Here is the current state of the
        platform.
      </p>

      {/* A wrong API base breaks every screen at once and is not any screen's
          own fault, so it is reported once, here, above everything else. */}
      {misrouted && (
        <WrongApiBaseNote
          url={misrouted instanceof ApiError ? misrouted.url : undefined}
          base={API_BASE}
        />
      )}

      {/* Billing health is the first thing on the page — a missing Lemon Squeezy
          API key means no purchase can be credited, and nothing else shows it. */}
      {isMissingRoute(overview.error) ? (
        <InfoNote title="This API build has no admin billing endpoints" tone="warn">
          <code>/v1/admin/billing/overview</code> answered <code>404</code>, so billing health
          cannot be checked from here until the API is redeployed.
        </InfoNote>
      ) : (
        <BillingStatus
          data={overview.data}
          loading={overview.initialLoading}
          error={overview.error}
          onRetry={overview.refetch}
        />
      )}

      <div className="stat-grid section">
        <Stat
          label="Total users"
          value={users.initialLoading ? null : userRows.length}
          hint={`${newThisWeek} joined in the last 7 days`}
          icon={<IconUsers />}
        />
        {/* Untriaged feedback sits in the top row on purpose: a user who wrote
            in is waiting on a person, and the one screen everyone opens is the
            only place that reliably gets noticed. */}
        <Stat
          label="Feedback to triage"
          value={untriaged.loading ? null : untriaged.count}
          hint={
            untriaged.count == null
              ? 'Requires the feedback endpoints'
              : untriaged.count === 0
                ? 'Nothing waiting — the inbox is clear'
                : 'Nobody has looked at these yet'
          }
          icon={<IconMessage />}
          tone={untriaged.count ? 'amber' : 'green'}
        />
        <Stat
          label="Community"
          value={community.initialLoading ? null : (community.data?.length ?? 0)}
          hint="Signups from the landing page"
          icon={<IconList />}
          tone="green"
        />
        <Stat
          label="Sellable plans"
          value={overview.data ? overview.data.plans?.sellable : null}
          hint={
            overview.data
              ? `${overview.data.plans?.total ?? 0} in the catalogue`
              : 'Requires admin billing'
          }
          icon={<IconCard />}
          tone="violet"
        />
        <Stat
          label={`Failures · ${WINDOW_HOURS}h`}
          value={stats.data ? stats.data.failed : null}
          hint={
            stats.data
              ? `${Math.round((stats.data.successRate ?? 0) * 100)}% success across ${formatNumber(stats.data.counted)} events`
              : 'Requires the activity log'
          }
          icon={<IconPulse />}
          tone="amber"
        />
      </div>

      {users.error && !isMissingRoute(users.error) && (
        <ErrorState error={users.error} onRetry={users.refetch} />
      )}

      {/* ------------------------------ chart ------------------------------- */}
      <div className="section">
        <div className="section-head">
          <h2>Activity · last {WINDOW_HOURS} hours</h2>
          <div className="spacer" />
          {stats.data?.avgDurationMs != null && (
            <Badge>avg {Math.round(stats.data.avgDurationMs)}ms</Badge>
          )}
          <Link className="btn btn-sm" to="/activity">
            Open the log
          </Link>
        </div>

        <div className="card card-pad">
          {isMissingRoute(stats.error) ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              <code>/v1/admin/logs/stats</code> is not present in this API build.
            </p>
          ) : stats.error ? (
            <ErrorState error={stats.error} onRetry={stats.refetch} />
          ) : stats.initialLoading ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : (
            <>
              <BarChart series={stats.data?.series ?? []} />
              <div className="chart-foot">
                <span>
                  <span className="swatch ok" /> succeeded
                </span>
                <span>
                  <span className="swatch failed" /> failed
                </span>
                <div className="spacer" />
                {/* Never let a capped count imply the chart is the whole window. */}
                {stats.data?.truncated ? (
                  <span className="text-warn">
                    Showing the first {formatNumber(stats.data.counted)} events — the window holds
                    more.
                  </span>
                ) : (
                  <span className="text-faint">
                    {formatNumber(stats.data?.total ?? 0)} events in this window.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* --------------------------- latest feedback ------------------------ */}
      <div className="section">
        <div className="section-head">
          <h2>Latest feedback</h2>
          <div className="spacer" />
          {untriaged.count ? (
            <Badge tone="amber">
              <span className="dot" />
              {untriaged.count} to triage
            </Badge>
          ) : null}
          <Link className="btn btn-sm" to="/feedback">
            Open the inbox
          </Link>
        </div>

        <div className="card">
          {/* An older API build has no /v1/feedback at all — say so rather than
              showing an empty inbox, which would read as "nobody wrote in". */}
          {isMissingRoute(feedback.error) ? (
            <div style={{ padding: 16 }}>
              <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                <code>/v1/feedback</code> is not present in this API build, so messages cannot be
                read from here yet.
              </p>
            </div>
          ) : feedback.error ? (
            <ErrorState error={feedback.error} onRetry={feedback.refetch} />
          ) : feedback.initialLoading ? (
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 16 }} />
              ))}
            </div>
          ) : feedback.data?.rows.length ? (
            <div className="feed">
              {feedback.data.rows.map((row) => (
                <Link
                  className={`feed-item log${row.status === UNTRIAGED ? ' unread' : ''}`}
                  to="/feedback"
                  key={row.id}
                >
                  <span
                    className={`log-marker${row.status === UNTRIAGED ? ' new' : ''}`}
                  />
                  <div className="feed-body">
                    <div className="feed-title">
                      <span className="log-actor">{row.name || row.email || 'anonymous'}</span>
                      <span className="log-dash"> — </span>
                      {row.subject || row.message.split(/\r?\n/, 1)[0]}
                    </div>
                    <div className="feed-meta">
                      <Badge tone={STATUS_TONE[row.status as FeedbackStatus] ?? ''}>
                        {row.status}
                      </Badge>
                      <Badge tone={KIND_TONE[row.kind as FeedbackKind] ?? ''}>{row.kind}</Badge>
                    </div>
                  </div>
                  <div className="feed-time" title={formatDateTime(row.createdAt)}>
                    {relativeTime(row.createdAt)}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No feedback yet" />
          )}
        </div>
      </div>

      {/* --------------------------- recent activity ------------------------ */}
      <div className="section">
        <div className="section-head">
          <h2>Recent activity</h2>
          <div className="spacer" />
          <Link className="btn btn-sm" to="/activity">
            Full log
          </Link>
        </div>

        <div className="card">
          {isMissingRoute(recent.error) || isMissingRoute(stats.error) ? (
            <div style={{ padding: 16 }}>
              <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                <code>/v1/admin/logs</code> is not present in this API build, so there is no
                activity to show yet. Redeploy the API to light this up.
              </p>
            </div>
          ) : recent.error ? (
            <ErrorState error={recent.error} onRetry={recent.refetch} />
          ) : recent.initialLoading ? (
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 16 }} />
              ))}
            </div>
          ) : recent.data?.rows.length ? (
            <div className="feed">
              {recent.data.rows.map((row) => (
                <Link className={`feed-item log${row.success ? '' : ' failed'}`} to="/activity" key={row.id}>
                  <span className={`log-marker${row.success ? '' : ' failed'}`} />
                  <div className="feed-body">
                    <div className="feed-title">
                      <span className="log-actor">{row.actorEmail ?? 'system'}</span>
                      <span className="log-dash"> — </span>
                      {row.summary}
                    </div>
                    <div className="feed-meta">
                      <code>{row.action}</code>
                    </div>
                  </div>
                  <div className="feed-time" title={formatDateTime(row.createdAt)}>
                    {relativeTime(row.createdAt)}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing recorded yet" />
          )}
        </div>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  hint,
  icon,
  tone = '',
}: {
  label: string
  value: number | null | undefined
  hint?: string
  icon: React.ReactNode
  tone?: string
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <div className={`stat-icon ${tone}`}>{icon}</div>
        {label}
      </div>
      {value === null || value === undefined ? (
        <div className="stat-value text-faint">—</div>
      ) : (
        <div className="stat-value">{value.toLocaleString()}</div>
      )}
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}
