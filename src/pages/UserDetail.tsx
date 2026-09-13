import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { displayValue, formatDateTime, humanizeKey, initialsOf, relativeTime } from '../lib/format'
import type { ApiUser } from '../lib/types'
import { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'
import { ErrorState, RoleBadge } from '../components/ui'
import { IconBack, IconEdit, IconRefresh, IconTrash } from '../components/icons'
import { EditUserModal } from './Users'

/** Rendered explicitly in the header, so they'd be redundant in the grid. */
const HEADER_FIELDS = new Set(['name', 'email', 'role'])
/** Never render a credential, even if the API were to return one. */
const SECRET_FIELDS = new Set(['password', 'passwordHash', 'hash', 'salt', 'refreshToken'])

export function UserDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { toast, toastError } = useToast()

  const user = useQuery((signal) => endpoints.user(id, signal), [id])
  const remove = useMutation(() => endpoints.deleteUser(id))

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function onDelete() {
    try {
      await remove.mutate()
      toast('User deleted')
      navigate('/users')
    } catch (err) {
      toastError(err, 'Could not delete the user')
    }
  }

  if (user.initialLoading) {
    return (
      <div className="card card-pad">
        <div className="skeleton" style={{ height: 18, width: 200, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 14, width: 320 }} />
      </div>
    )
  }

  if (user.error) {
    return (
      <>
        <BackLink />
        <ErrorState error={user.error} onRetry={user.refetch} />
      </>
    )
  }

  // The spec doesn't describe this response, so the record may be wrapped.
  const record = unwrapUser(user.data)

  if (!record) {
    return (
      <>
        <BackLink />
        <div className="card card-pad">No user record was returned for ID {id}.</div>
      </>
    )
  }

  const extras = Object.entries(record).filter(
    ([key, value]) =>
      !HEADER_FIELDS.has(key) &&
      !SECRET_FIELDS.has(key) &&
      typeof value !== 'function',
  )

  return (
    <>
      <BackLink />

      <div className="detail-head">
        <div className="avatar lg">{initialsOf(record.name, record.email)}</div>
        <div>
          <h2>{String(record.name || record.email || `User ${id}`)}</h2>
          <div className="sub">
            {String(record.email ?? '—')} · joined {relativeTime(record.createdAt)}
          </div>
        </div>
        <div className="spacer" />
        <RoleBadge role={record.role} />
        <button className="btn" onClick={user.refetch} disabled={user.loading}>
          <IconRefresh />
          Refresh
        </button>
        <button className="btn" onClick={() => setEditing(true)}>
          <IconEdit />
          Edit
        </button>
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
          <IconTrash />
          Delete
        </button>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Account record</h2>
        </div>
        {/*
          Rendered generically rather than as a fixed column list: the API's
          user payload is undocumented, so any field it returns shows up here
          instead of being silently dropped.
        */}
        <div className="prop-grid">
          {extras.map(([key, value]) => (
            <div className="prop" key={key}>
              <div className="prop-key">{humanizeKey(key)}</div>
              <div className="prop-val">{displayValue(value)}</div>
            </div>
          ))}
        </div>
      </div>

      {record.createdAt != null && (
        <div className="section">
          <div className="section-head">
            <h2>Dates</h2>
          </div>
          <div className="prop-grid">
            <div className="prop">
              <div className="prop-key">Registered</div>
              <div className="prop-val">{formatDateTime(record.createdAt)}</div>
            </div>
            <div className="prop">
              <div className="prop-key">Account age</div>
              <div className="prop-val">{relativeTime(record.createdAt)}</div>
            </div>
            {record.updatedAt != null && (
              <div className="prop">
                <div className="prop-key">Last updated</div>
                <div className="prop-val">{formatDateTime(record.updatedAt)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <EditUserModal
          user={record}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false)
            user.refetch()
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this user?"
          destructive
          confirmLabel="Delete user"
          pending={remove.pending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void onDelete()}
          message={
            <>
              <strong style={{ color: 'var(--text)' }}>
                {String(record.name || record.email)}
              </strong>{' '}
              will be permanently removed. This cannot be undone.
            </>
          }
        />
      )}
    </>
  )
}

function BackLink() {
  return (
    <Link to="/users" className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
      <IconBack />
      All users
    </Link>
  )
}

function unwrapUser(payload: unknown): ApiUser | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.email || record.id != null) return record as ApiUser
  for (const key of ['user', 'data']) {
    const nested = record[key]
    if (nested && typeof nested === 'object') return nested as ApiUser
  }
  return null
}
