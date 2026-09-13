import type { ReactNode } from 'react'
import { IconAlert, IconInbox, IconInfo } from './icons'
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
