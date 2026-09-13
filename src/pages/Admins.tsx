import { useState, type FormEvent } from 'react'
import { endpoints } from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { formatDateTime, initialsOf, relativeTime } from '../lib/format'
import type { Admin, CreateAdminInput, Role, UpdateAdminInput } from '../lib/types'
import { STAFF_ROLES } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { ConfirmDialog, Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  EmptyState,
  ErrorState,
  Field,
  InfoNote,
  RoleBadge,
  TableSkeleton,
} from '../components/ui'
import { IconEdit, IconPlus, IconRefresh, IconTrash } from '../components/icons'

export function Admins() {
  const { user, isSuperAdmin } = useAuth()
  const { toast, toastError } = useToast()

  const admins = useQuery((signal) => endpoints.admins(signal))
  const remove = useMutation((id: number) => endpoints.deleteAdmin(id))

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Admin | null>(null)
  const [deleting, setDeleting] = useState<Admin | null>(null)

  // The whole /v1/admin surface is SUPERADMIN-only; an ADMIN would just collect
  // 403s, so say that instead of rendering a broken table.
  if (!isSuperAdmin) {
    return (
      <InfoNote title="SUPERADMIN access required" tone="warn">
        Admin account management is restricted to the SUPERADMIN role. Your account is{' '}
        <strong>{user?.role}</strong>.
      </InfoNote>
    )
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutate(Number(deleting.id))
      toast(`Removed ${deleting.name || deleting.email}`)
      setDeleting(null)
      admins.refetch()
    } catch (err) {
      toastError(err, 'Could not remove the admin')
    }
  }

  const rows = admins.data ?? []

  return (
    <>
      <p className="page-intro">
        Staff accounts with panel access, from <code>/v1/admin</code>. Only a SUPERADMIN can create,
        edit or remove them.
      </p>

      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={admins.refetch} disabled={admins.loading}>
          <IconRefresh />
          Refresh
        </button>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus />
          New admin
        </button>
      </div>

      {admins.error && <ErrorState error={admins.error} onRetry={admins.refetch} />}

      {admins.initialLoading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        !admins.error && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const isSelf = user?.id === a.id
                  return (
                    <tr key={String(a.id)}>
                      <td>
                        <div className="cell-user">
                          <div className="avatar">{initialsOf(a.name, a.email)}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-user-name">
                              {a.name || '—'}
                              {isSelf && (
                                <span className="badge blue" style={{ marginLeft: 8 }}>
                                  You
                                </span>
                              )}
                            </div>
                            <div className="cell-user-email">{a.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono">{String(a.id)}</td>
                      <td>
                        <RoleBadge role={a.role} />
                      </td>
                      <td className="nowrap" title={formatDateTime(a.createdAt)}>
                        {relativeTime(a.createdAt)}
                      </td>
                      <td className="actions">
                        <button
                          className="btn btn-icon"
                          onClick={() => setEditing(a)}
                          title="Edit admin"
                        >
                          <IconEdit />
                        </button>
                        <button
                          className="btn btn-icon danger"
                          onClick={() => setDeleting(a)}
                          // Removing your own account would end the session
                          // mid-flight and lock you out of the panel.
                          disabled={isSelf}
                          title={isSelf ? 'You cannot remove your own account' : 'Remove admin'}
                        >
                          <IconTrash />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!rows.length && (
              <EmptyState
                title="No admin accounts"
                message="Create one to give a teammate access to this panel."
              />
            )}
          </div>
        )
      )}

      {creating && (
        <AdminForm
          mode="create"
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            admins.refetch()
          }}
        />
      )}

      {editing && (
        <AdminForm
          mode="edit"
          admin={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            admins.refetch()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Remove this admin?"
          destructive
          confirmLabel="Remove admin"
          pending={remove.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              <strong style={{ color: 'var(--text)' }}>{deleting.name || deleting.email}</strong>{' '}
              will lose access to the admin panel immediately.
            </>
          }
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Create / edit form                                                          */
/* -------------------------------------------------------------------------- */

function AdminForm({
  mode,
  admin,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit'
  admin?: Admin
  onClose: () => void
  onDone: () => void
}) {
  const { toast, toastError } = useToast()
  const [name, setName] = useState(String(admin?.name ?? ''))
  const [email, setEmail] = useState(String(admin?.email ?? ''))
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>((admin?.role as Role) ?? 'ADMIN')

  const save = useMutation(async (payload: CreateAdminInput | UpdateAdminInput) => {
    if (mode === 'create') return endpoints.createAdmin(payload as CreateAdminInput)
    return endpoints.updateAdmin(Number(admin!.id), payload as UpdateAdminInput)
  })

  const passwordTooShort = password.length > 0 && password.length < 8

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    let payload: CreateAdminInput | UpdateAdminInput
    if (mode === 'create') {
      payload = { name: name.trim(), email: email.trim(), password, role }
    } else {
      // Send only what changed, so a blank password field doesn't reset one.
      const patch: UpdateAdminInput = {}
      if (name.trim() !== admin?.name) patch.name = name.trim()
      if (email.trim() !== admin?.email) patch.email = email.trim()
      if (role !== admin?.role) patch.role = role
      if (password) patch.password = password

      if (!Object.keys(patch).length) {
        onClose()
        return
      }
      payload = patch
    }

    try {
      await save.mutate(payload)
      toast(mode === 'create' ? `Created admin ${email}` : 'Admin updated')
      onDone()
    } catch (err) {
      toastError(err, 'Could not save the admin account')
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'New admin' : 'Edit admin'}
      subtitle={
        mode === 'create'
          ? 'POST /v1/admin — requires the SUPERADMIN role.'
          : `PATCH /v1/admin/${admin?.id}`
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={save.pending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            form="admin-form"
            type="submit"
            disabled={save.pending || passwordTooShort}
          >
            {save.pending && <span className="spinner" />}
            {mode === 'create' ? 'Create admin' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="admin-form" onSubmit={onSubmit}>
        <Field label="Full name">
          <input
            className="input"
            required={mode === 'create'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            required={mode === 'create'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.doe@example.com"
          />
        </Field>
        <Field
          label={mode === 'create' ? 'Password' : 'New password'}
          hint={
            mode === 'create'
              ? 'Minimum 8 characters.'
              : 'Leave blank to keep the current password.'
          }
          error={passwordTooShort ? 'Password must be at least 8 characters.' : undefined}
        >
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required={mode === 'create'}
            minLength={mode === 'create' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Role" hint="SUPERADMIN can additionally manage other admin accounts.">
          <select
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  )
}
