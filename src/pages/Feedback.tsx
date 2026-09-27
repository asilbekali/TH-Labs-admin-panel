import { useCallback, useMemo, useState, type FormEvent } from 'react'
import {
  API_BASE,
  ApiError,
  endpoints,
  isForbidden,
  isMissingRoute,
  isWrongApiBase,
} from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { formatDateTime, initialsOf, relativeTime } from '../lib/format'
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  KIND_TONE,
  STATUS_TONE,
  UNTRIAGED,
  type FeedbackKind,
  type FeedbackQuery,
  type FeedbackRow,
  type FeedbackStatus,
  type UpdateFeedbackInput,
} from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { useFeedbackInbox } from '../lib/feedbackInbox'
import { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  ForbiddenNote,
  InfoNote,
  MissingRouteNote,
  Pagination,
  TableSkeleton,
  WrongApiBaseNote,
} from '../components/ui'
import {
  IconChevron,
  IconRefresh,
  IconSearch,
  IconStar,
  IconTrash,
  IconX,
} from '../components/icons'

/**
 * What the status dropdown falls back to when the server sends a value this
 * build does not know about — a status added to the enum after this deploy.
 * Picked over NEW so an unknown value cannot be re-triaged *back* into the
 * untriaged count by someone saving the form.
 *
 * Note what this is NOT: opening a message never changes its status. Reading a
 * row is not a decision about it, so nothing is marked automatically, and that
 * is what keeps the NEW count in the sidebar an honest "nobody has dealt with
 * this" rather than "nobody has clicked it".
 */
const UNKNOWN_STATUS_FALLBACK: FeedbackStatus = 'READ'

interface Filters {
  q: string
  status: '' | FeedbackStatus
  kind: '' | FeedbackKind
}

const EMPTY_FILTERS: Filters = { q: '', status: '', kind: '' }

export function Feedback() {
  const { user, isSuperAdmin } = useAuth()
  const { toast, toastError } = useToast()
  const inboxCount = useFeedbackInbox()

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [deleting, setDeleting] = useState<FeedbackRow | null>(null)

  const query: FeedbackQuery = useMemo(
    () => ({
      page,
      limit,
      q: filters.q || undefined,
      status: filters.status || undefined,
      kind: filters.kind || undefined,
    }),
    [page, limit, filters],
  )

  const inbox = useQuery((signal) => endpoints.feedback(query, signal), [query])
  const remove = useMutation((id: number) => endpoints.deleteFeedback(id))

  const rows = inbox.data?.rows ?? []
  const total = inbox.data?.total ?? rows.length
  const pageCount = Math.max(Math.ceil(total / limit), 1)
  const filtered = Object.values(filters).some((v) => v !== '')

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  // Re-read the list AND the shared untriaged count together: triaging a
  // message is exactly when the sidebar badge goes stale, and waiting out a
  // poll to correct it makes the badge feel broken.
  //
  // Both are stable useCallbacks, so this depends on the two functions rather
  // than their containing objects — the objects are new every render and would
  // give this one a new identity each time. Same as Activity's refresh.
  const refresh = useCallback(() => {
    inbox.refetch()
    inboxCount.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox.refetch, inboxCount.refresh])

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutate(deleting.id)
      toast('Feedback message deleted')
      setDeleting(null)
      refresh()
    } catch (err) {
      toastError(err, 'Could not delete the message')
    }
  }

  // Same three-way split as the activity log: a wrong base URL, a route the
  // API build does not have, and a role that may not read it look identical
  // from an empty list and share no fix at all.
  const blocker = inbox.error
  if (isWrongApiBase(blocker) || isMissingRoute(blocker) || isForbidden(blocker)) {
    return (
      <>
        <p className="page-intro">Messages people sent from the app and the landing page.</p>
        {isWrongApiBase(blocker) ? (
          <WrongApiBaseNote
            url={blocker instanceof ApiError ? blocker.url : undefined}
            base={API_BASE}
          />
        ) : isForbidden(blocker) ? (
          <ForbiddenNote what="feedback inbox" role={user?.role} />
        ) : (
          <MissingRouteNote what="feedback" routes={['/v1/feedback']} />
        )}
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={refresh}>
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
        Every message sent through <code>POST /v1/feedback</code> — from the app, the pricing page
        or the landing page — lands here. Anyone can write one; only ADMIN and SUPERADMIN can read
        and triage them, and only a SUPERADMIN can delete one.
      </p>

      {/* ----------------------------- filters ------------------------------ */}
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search subject, message, name or email…"
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
          />
        </div>

        <select
          className="select"
          style={{ width: 'auto' }}
          value={filters.kind}
          onChange={(e) => setFilter('kind', e.target.value as Filters['kind'])}
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>

        <div className="spacer" />

        <button className="btn" onClick={refresh} disabled={inbox.loading}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      {/* ------------------------- status quick filters ---------------------- */}
      <div className="chip-row">
        <button
          className={`chip${filters.status === '' ? ' on' : ''}`}
          onClick={() => setFilter('status', '')}
        >
          All
        </button>
        {FEEDBACK_STATUSES.map((s) => (
          <button
            key={s}
            className={`chip${filters.status === s ? ' on' : ''}`}
            onClick={() => setFilter('status', filters.status === s ? '' : s)}
          >
            {s === UNTRIAGED ? 'New — needs triage' : s.replace('_', ' ').toLowerCase()}
          </button>
        ))}

        {filtered && (
          <button className="chip clear" onClick={() => setFilters(EMPTY_FILTERS)}>
            <IconX />
            Clear filters
          </button>
        )}
      </div>

      {inbox.error && <ErrorState error={inbox.error} onRetry={refresh} />}

      {inbox.initialLoading ? (
        <TableSkeleton rows={8} cols={3} />
      ) : (
        !inbox.error && (
          <div className="card">
            {rows.length ? (
              <div className="feed">
                {rows.map((row) => (
                  <FeedbackEntry
                    key={row.id}
                    row={row}
                    canDelete={isSuperAdmin}
                    onChanged={refresh}
                    onDelete={() => setDeleting(row)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={filtered ? 'No messages match these filters' : 'No feedback yet'}
                message={
                  filtered
                    ? 'Clear the filters or pick a different status.'
                    : 'Messages appear here the moment someone sends one — nothing has to be polled or imported.'
                }
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

      {!isSuperAdmin && (
        <InfoNote title="Deleting requires SUPERADMIN">
          Your role can read every message and triage it. Deleting is restricted to SUPERADMIN —
          mark a message <code>SPAM</code> instead, which is reversible.
        </InfoNote>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this feedback message?"
          destructive
          confirmLabel="Delete message"
          pending={remove.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              The message from{' '}
              <strong style={{ color: 'var(--text)' }}>
                {deleting.name || deleting.email || 'an anonymous sender'}
              </strong>{' '}
              will be removed permanently. This cannot be undone — marking it{' '}
              <code>SPAM</code> keeps it and can be changed back.
            </>
          }
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* One message                                                                 */
/* -------------------------------------------------------------------------- */

function FeedbackEntry({
  row,
  canDelete,
  onChanged,
  onDelete,
}: {
  row: FeedbackRow
  canDelete: boolean
  onChanged: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const isNew = row.status === UNTRIAGED

  return (
    <div className={`feed-item log${isNew ? ' unread' : ''}`}>
      <button className="log-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`log-marker${isNew ? ' new' : ''}`} />

        <span className="feed-body">
          <span className="feed-title">
            <span className="log-actor">{row.name || row.email || 'anonymous'}</span>
            <span className="log-dash"> — </span>
            {row.subject || firstLine(row.message)}
          </span>
          <span className="feed-meta">
            <Badge tone={STATUS_TONE[row.status as FeedbackStatus] ?? ''}>{row.status}</Badge>
            <Badge tone={KIND_TONE[row.kind as FeedbackKind] ?? ''}>{row.kind}</Badge>
            {row.rating != null && (
              <span className="text-faint rating">
                <IconStar />
                {row.rating}/5
              </span>
            )}
            {row.userId == null && <span className="text-faint">not signed in</span>}
            {row.pagePath && <code>{row.pagePath}</code>}
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
            <Detail label="From">
              <div className="cell-user">
                <div className="avatar">{initialsOf(row.name, row.email)}</div>
                <span>{row.name || '—'}</span>
              </div>
            </Detail>
            <Detail label="Reply to">
              {row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : '—'}
            </Detail>
            <Detail label="Account">
              {/*
                The server overwrites name and email from the bearer token for a
                signed-in sender, so those two fields are only trustworthy when
                there is a userId. Say which, rather than presenting a
                self-reported email as if it were verified.
              */}
              {row.userId != null ? (
                <>
                  <span className="mono">#{row.userId}</span>
                  <span className="text-faint"> — from the token, verified</span>
                </>
              ) : (
                <span className="text-faint">anonymous — name and email are self-reported</span>
              )}
            </Detail>
            <Detail label="Sent">{formatDateTime(row.createdAt)}</Detail>
            <Detail label="Page">{row.pagePath ?? '—'}</Detail>
            <Detail label="User agent">
              <span className="truncate" title={row.userAgent ?? ''}>
                {row.userAgent ?? '—'}
              </span>
            </Detail>
          </div>

          <div className="log-detail-label">Message</div>
          <p className="feedback-message">{row.message}</p>

          <TriageForm row={row} canDelete={canDelete} onDone={onChanged} onDelete={onDelete} />
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

/** The first line of a message, for the collapsed row's title. */
function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0].trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line || '(empty message)'
}

/* -------------------------------------------------------------------------- */
/* Triage                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * PATCH /v1/feedback/:id.
 *
 * Both fields are optional on the body, so only what actually changed is sent —
 * otherwise saving a status would rewrite the note with whatever was on screen
 * when the row was opened, and a staff note is not something to lose quietly.
 */
function TriageForm({
  row,
  canDelete,
  onDone,
  onDelete,
}: {
  row: FeedbackRow
  canDelete: boolean
  onDone: () => void
  onDelete: () => void
}) {
  const { toast, toastError } = useToast()
  const initialNote = row.adminNote ?? ''

  const [status, setStatus] = useState<FeedbackStatus>(
    (FEEDBACK_STATUSES as string[]).includes(row.status)
      ? (row.status as FeedbackStatus)
      : UNKNOWN_STATUS_FALLBACK,
  )
  const [note, setNote] = useState(initialNote)

  const update = useMutation((input: UpdateFeedbackInput) =>
    endpoints.updateFeedback(row.id, input),
  )

  const dirty = status !== row.status || note !== initialNote

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    const patch: UpdateFeedbackInput = {}
    if (status !== row.status) patch.status = status
    if (note !== initialNote) patch.adminNote = note

    if (!Object.keys(patch).length) return

    try {
      await update.mutate(patch)
      toast(patch.status ? `Marked ${patch.status.toLowerCase()}` : 'Note saved')
      onDone()
    } catch (err) {
      toastError(err, 'Could not update the message')
    }
  }

  return (
    <form className="inline-editor" onSubmit={onSubmit}>
      <div className="inline-editor-grid">
        <Field label="Status" hint="Only a person can move this — opening a message changes nothing.">
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Staff note" hint="Private — never shown to the sender.">
        <textarea
          className="input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reproduced on an 11-minute clip. Filed as PIPE-204."
        />
      </Field>

      <div className="inline-editor-actions">
        {canDelete && (
          <button type="button" className="btn btn-sm danger" onClick={onDelete}>
            <IconTrash />
            Delete
          </button>
        )}
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" type="submit" disabled={!dirty || update.pending}>
          {update.pending && <span className="spinner" />}
          Save triage
        </button>
      </div>
    </form>
  )
}
