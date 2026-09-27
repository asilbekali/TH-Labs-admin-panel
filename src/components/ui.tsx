import { useState, type ReactNode } from 'react'
import { IconAlert, IconCheck, IconCopy, IconInbox, IconInfo } from './icons'
import type { Role } from '../lib/types'

/* -------------------------------------------------------------------------- */
/* Badges                                                                      */
/* -------------------------------------------------------------------------- */

const ROLE_TONE: Record<Role, string> = {
  SUPERADMIN: 'violet',
  ADMIN: 'blue',
  USER: '',
}

export function RoleBadge({ role }: { role: unknown }) {
  const key = typeof role === 'string' ? role : 'USER'
  const tone = ROLE_TONE[key as Role] ?? ''
  return <span className={`badge ${tone}`}>{key}</span>
}

export function Badge({ tone = '', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <IconInbox />
      </div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="alert error">
      <IconAlert />
      <div className="alert-body">
        <strong>Could not load this data</strong>
        {error.message}
        {onRetry && (
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function InfoNote({
  title,
  children,
  tone = 'info',
}: {
  title?: string
  children: ReactNode
  tone?: 'info' | 'warn'
}) {
  return (
    <div className={`alert ${tone}`}>
      {tone === 'warn' ? <IconAlert /> : <IconInfo />}
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: 'flex', gap: 12 }}>
            {Array.from({ length: cols }).map((_, c) => (
              <div
                key={c}
                className="skeleton"
                style={{ height: 15, flex: c === 0 ? 2 : 1, opacity: 1 - r * 0.11 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Form field                                                                  */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize?: (n: number) => void
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <div className="pagination">
      <span>
        {first}–{last} of {total.toLocaleString()}
      </span>
      {onPageSize && (
        <select
          className="select"
          style={{ width: 'auto', padding: '3px 26px 3px 8px', fontSize: 12.5 }}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          aria-label="Rows per page"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      )}
      <div className="spacer" />
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="nowrap">
        Page {page} of {Math.max(pageCount, 1)}
      </span>
      <button
        className="btn btn-sm"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* API-build mismatch                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Shown when *the API* 404s an endpoint — a JSON `404`, not any old one.
 *
 * A missing route means "the API is older than this screen", not "something
 * broke". Saying which is the difference between a five-minute redeploy and an
 * afternoon of debugging the panel. Which is exactly why this must not fire on
 * an HTML 404 from a misrouted request — that is WrongApiBaseNote, and it used
 * to land here and send people off to redeploy a perfectly good backend.
 */
export function MissingRouteNote({ routes, what }: { routes: string[]; what: string }) {
  return (
    <InfoNote title={`This API build has no ${what} endpoints`} tone="warn">
      The API answered <code>404</code> for {routes.map((r) => <code key={r}>{r} </code>)}. That
      route exists in the current backend but is not present in the build this panel is pointed
      at, so there is nothing to show until the API is redeployed. Nothing is wrong with the
      panel, and no data has been lost.
    </InfoNote>
  )
}

/**
 * Shown when a request reached something that is not the API.
 *
 * `th-labs.uz` serves a Next.js app at the root and the API only under `/v1`,
 * so a panel whose base URL is off by a segment gets that app's **HTML 404**
 * for every call. The tell is a 404 with no JSON envelope, and the fix is
 * always deploy config, never the backend — so this names the URL it actually
 * called rather than making you open the network tab to find out.
 */
export function WrongApiBaseNote({ url, base }: { url?: string; base: string }) {
  return (
    <InfoNote title="The panel is not talking to the API" tone="warn">
      <span>
        {url ? (
          <>
            <code>{url}</code> answered <code>404</code> with an HTML page rather than the API's
            JSON.
          </>
        ) : (
          <>
            A request answered <code>404</code> with an HTML page rather than the API's JSON.
          </>
        )}{' '}
        The route itself is fine — something that is not the API is serving this path, so every
        screen here will fail the same way.
      </span>
      <span>
        This panel resolves API calls against <code>{base}</code>. In production that has to be
        rewritten to <code>https://th-labs.uz/v1</code> (the <code>/api/:path*</code> rewrite in{' '}
        <code>vercel.json</code>), or <code>VITE_API_BASE_URL</code> set to{' '}
        <code>https://th-labs.uz/v1</code> at build time. The API root itself is <code>/v1</code>;{' '}
        <code>/api</code> on <code>th-labs.uz</code> belongs to the marketing app.
      </span>
    </InfoNote>
  )
}

/**
 * Shown when the API accepted the session but refused the role.
 *
 * Distinct from both notes above on purpose: nothing is misconfigured and
 * nothing needs redeploying — this account simply may not read this.
 */
export function ForbiddenNote({ what, role }: { what: string; role?: string }) {
  return (
    <InfoNote title={`Your role cannot read the ${what}`} tone="warn">
      The API accepted the session and then answered <code>403</code>.
      {role ? (
        <>
          {' '}
          This account signs in as <code>{role}</code>, which the API does not grant access to
          these routes.
        </>
      ) : null}{' '}
      Nothing is broken and nothing needs redeploying — the role is the gate.
    </InfoNote>
  )
}

/* -------------------------------------------------------------------------- */
/* Severity banner                                                             */
/* -------------------------------------------------------------------------- */

export type Severity = 'critical' | 'warn' | 'ok' | 'info'

/**
 * One line of billing health. `critical` is reserved for the failure that is
 * invisible until a customer has already been charged.
 */
export function StatusRow({
  severity,
  title,
  children,
}: {
  severity: Severity
  title: string
  children?: ReactNode
}) {
  return (
    <div className={`status-row ${severity}`}>
      <span className="status-dot" />
      <div className="status-body">
        <strong>{title}</strong>
        {children && <span>{children}</span>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Copyable value                                                              */
/* -------------------------------------------------------------------------- */

export function CopyValue({ value, empty = '—' }: { value?: string | null; empty?: string }) {
  const [copied, setCopied] = useState(false)

  if (!value) return <span className="text-faint">{empty}</span>

  return (
    <button
      type="button"
      className="copy-value"
      title={`Copy ${value}`}
      onClick={() => {
        // Clipboard access can be refused (insecure origin, denied permission);
        // the value is on screen either way, so a failure just isn't confirmed.
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          },
          () => undefined,
        )
      }}
    >
      <span className="mono truncate">{value}</span>
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Bar chart                                                                   */
/* -------------------------------------------------------------------------- */

export interface ChartPoint {
  at: string
  total: number
  failed: number
}

/**
 * The log `stats.series`, drawn as stacked bars: failures in red on top of
 * successes. Pure CSS heights — the series is short enough that a charting
 * dependency would cost more than it returns.
 */
export function BarChart({ series, height = 120 }: { series: ChartPoint[]; height?: number }) {
  if (!series.length) {
    return <div className="chart-empty">No events in this window.</div>
  }

  const max = Math.max(...series.map((p) => p.total), 1)

  return (
    <div className="chart" style={{ height }}>
      {series.map((point) => {
        const ok = Math.max(point.total - point.failed, 0)
        return (
          <div
            className="chart-col"
            key={point.at}
            title={`${new Date(point.at).toLocaleString()} — ${point.total} events, ${point.failed} failed`}
          >
            <div className="chart-stack">
              <div
                className="chart-bar failed"
                style={{ height: `${(point.failed / max) * 100}%` }}
              />
              <div className="chart-bar ok" style={{ height: `${(ok / max) * 100}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
