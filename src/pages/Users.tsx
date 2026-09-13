import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { formatDateTime, initialsOf, relativeTime } from '../lib/format'
import type { ApiUser, CreateUserInput, Role, UpdateUserInput } from '../lib/types'
import { ROLES } from '../lib/types'
import { ConfirmDialog, Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  EmptyState,
  ErrorState,
  Field,
  Pagination,
  RoleBadge,
  TableSkeleton,
} from '../components/ui'
import { IconEdit, IconEye, IconRefresh, IconSearch, IconTrash, IconUserPlus } from '../components/icons'

type SortKey = 'name' | 'email' | 'role' | 'createdAt' | 'id'
type SortDir = 'asc' | 'desc'

export function Users() {
  const { toast, toastError } = useToast()
  const users = useQuery((signal) => endpoints.users(signal))

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ApiUser | null>(null)
  const [deleting, setDeleting] = useState<ApiUser | null>(null)

  const removeUser = useMutation((id: number | string) => endpoints.deleteUser(id))

  // The API returns every user in one unpaginated payload, so filtering,
  // sorting and paging all happen client-side.
  const filtered = useMemo(() => {
    const rows = users.data ?? []
    const q = search.trim().toLowerCase()

    const matched = rows.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false
      if (!q) return true
      return (
        String(u.name ?? '').toLowerCase().includes(q) ||
        String(u.email ?? '').toLowerCase().includes(q) ||
        String(u.id ?? '').includes(q)
      )
    })

    const dir = sortDir === 'asc' ? 1 : -1
    return [...matched].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (sortKey === 'createdAt') {
        return (new Date(String(av)).getTime() - new Date(String(bv)).getTime()) * dir
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir
    })
  }, [users.data, search, roleFilter, sortKey, sortDir])

  const pageCount = Math.ceil(filtered.length / pageSize)
  const safePage = Math.min(page, Math.max(pageCount, 1))
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'createdAt' ? 'desc' : 'asc')
    }
    setPage(1)
  }

  function sortHead(key: SortKey, label: string) {
    return (
      <th className="sortable" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key && <span className="sort-caret">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </th>
    )
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await removeUser.mutate(deleting.id)
      toast(`Deleted ${deleting.name || deleting.email}`)
      setDeleting(null)
      users.refetch()
    } catch (err) {
      toastError(err, 'Could not delete the user')
    }
  }

  return (
    <>
      <p className="page-intro">
        Every registered account, from <code>GET /v1/users/all-users-data</code>. Search, filter by
        role, open a user to see their full record, or edit and remove accounts.
      </p>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search name, email or ID…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>

        <select
          className="select"
          style={{ width: 'auto' }}
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as 'ALL' | Role)
            setPage(1)
          }}
          aria-label="Filter by role"
        >
          <option value="ALL">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <div className="spacer" />

        <button className="btn" onClick={users.refetch} disabled={users.loading}>
          <IconRefresh />
          Refresh
        </button>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconUserPlus />
          New user
        </button>
      </div>

      {users.error && <ErrorState error={users.error} onRetry={users.refetch} />}

      {users.initialLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        !users.error && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {sortHead('name', 'User')}
                  {sortHead('id', 'ID')}
                  {sortHead('role', 'Role')}
                  {sortHead('createdAt', 'Joined')}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={String(u.id)}>
                    <td>
                      <div className="cell-user">
                        <div className="avatar">{initialsOf(u.name, u.email)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-user-name">{u.name || '—'}</div>
                          <div className="cell-user-email">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{String(u.id)}</td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="nowrap" title={formatDateTime(u.createdAt)}>
                      {relativeTime(u.createdAt)}
                    </td>
                    <td className="actions">
                      <Link className="btn btn-icon" to={`/users/${u.id}`} title="View details">
                        <IconEye />
                      </Link>
                      <button
                        className="btn btn-icon"
                        onClick={() => setEditing(u)}
                        title="Edit user"
                      >
                        <IconEdit />
                      </button>
                      <button
                        className="btn btn-icon danger"
                        onClick={() => setDeleting(u)}
                        title="Delete user"
                      >
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!visible.length && (
              <EmptyState
                title={filtered.length === 0 && (search || roleFilter !== 'ALL') ? 'No matches' : 'No users yet'}
                message={
                  search || roleFilter !== 'ALL'
                    ? 'Try a different search term or role filter.'
                    : 'Users will appear here once people register.'
                }
              />
            )}

            {filtered.length > 0 && (
              <Pagination
                page={safePage}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={(n) => {
                  setPageSize(n)
                  setPage(1)
                }}
              />
            )}
          </div>
        )
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            users.refetch()
          }}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            users.refetch()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this user?"
          destructive
          confirmLabel="Delete user"
          pending={removeUser.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              <strong style={{ color: 'var(--text)' }}>
                {deleting.name || deleting.email}
              </strong>{' '}
              will be permanently removed. This cannot be undone.
            </>
          }
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast, toastError } = useToast()
  const [form, setForm] = useState<CreateUserInput>({ name: '', email: '', password: '' })
  const create = useMutation((input: CreateUserInput) => endpoints.createUser(input))

  const passwordTooShort = form.password.length > 0 && form.password.length < 8

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await create.mutate({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      toast(`Created ${form.email}`)
      onDone()
    } catch (err) {
      toastError(err, 'Could not create the user')
    }
  }

  return (
    <Modal
      title="New user"
      subtitle="Registers a standard USER account via POST /v1/users/create-user."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={create.pending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            form="create-user-form"
            type="submit"
            disabled={create.pending || passwordTooShort}
          >
            {create.pending && <span className="spinner" />}
            Create user
          </button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={onSubmit}>
        <Field label="Full name">
          <input
            className="input"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="John Doe"
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="john.doe@example.com"
          />
        </Field>
        <Field
          label="Password"
          hint="Minimum 8 characters."
          error={passwordTooShort ? 'Password must be at least 8 characters.' : undefined}
        >
          <input
            className="input"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

export function EditUserModal({
  user,
  onClose,
  onDone,
}: {
  user: ApiUser
  onClose: () => void
  onDone: () => void
}) {
  const { toast, toastError } = useToast()
  const [name, setName] = useState(String(user.name ?? ''))
  const [email, setEmail] = useState(String(user.email ?? ''))
  const [password, setPassword] = useState('')

  const update = useMutation((input: UpdateUserInput) => endpoints.updateUser(user.id, input))

  const passwordTooShort = password.length > 0 && password.length < 8

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    // UpdateUserDto has every field optional — send only what actually changed
    // so an unrelated field can't be clobbered.
    const patch: UpdateUserInput = {}
    if (name.trim() !== user.name) patch.name = name.trim()
    if (email.trim() !== user.email) patch.email = email.trim()
    if (password) patch.password = password

    if (!Object.keys(patch).length) {
      onClose()
      return
    }

    try {
      await update.mutate(patch)
      toast('User updated')
      onDone()
    } catch (err) {
      toastError(err, 'Could not update the user')
    }
  }

  return (
    <Modal
      title="Edit user"
      subtitle={`PATCH /v1/users/${user.id} — only changed fields are sent.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={update.pending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            form="edit-user-form"
            type="submit"
            disabled={update.pending || passwordTooShort}
          >
            {update.pending && <span className="spinner" />}
            Save changes
          </button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={onSubmit}>
        <Field label="Full name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="New password"
          hint="Leave blank to keep the current password."
          error={passwordTooShort ? 'Password must be at least 8 characters.' : undefined}
        >
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
      </form>
    </Modal>
  )
}
