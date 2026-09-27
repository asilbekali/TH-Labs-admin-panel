import { useMemo, useState, type FormEvent } from 'react'
import { endpoints } from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { formatDateTime, initialsOf, relativeTime } from '../lib/format'
import type { CommunityMember, UpdateCommunityInput } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { ConfirmDialog, Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  EmptyState,
  ErrorState,
  Field,
  InfoNote,
  Pagination,
  TableSkeleton,
} from '../components/ui'
import { IconEdit, IconRefresh, IconSearch, IconTrash } from '../components/icons'

export function Community() {
  const { isSuperAdmin } = useAuth()
  const { toast, toastError } = useToast()

  const members = useQuery((signal) => endpoints.community(signal))
  const remove = useMutation((id: number | string) => endpoints.deleteCommunityMember(id))

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<CommunityMember | null>(null)
  const [deleting, setDeleting] = useState<CommunityMember | null>(null)

  const filtered = useMemo(() => {
    const rows = members.data ?? []
    const q = search.trim().toLowerCase()
    const matched = q
      ? rows.filter(
          (e) =>
            String(e.userName ?? '').toLowerCase().includes(q) ||
            String(e.email ?? '').toLowerCase().includes(q),
        )
      : rows
    // Newest first — the useful default for a signup queue.
    return [...matched].sort(
      (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
    )
  }, [members.data, search])

  const pageCount = Math.ceil(filtered.length / pageSize)
  const safePage = Math.min(page, Math.max(pageCount, 1))
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutate(deleting.id)
      toast('Community member removed')
      setDeleting(null)
      members.refetch()
    } catch (err) {
      toastError(err, 'Could not remove the member')
    }
  }

  function exportCsv() {
    const header = ['id', 'userName', 'email', 'createdAt']
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [
      header.join(','),
      ...filtered.map((e) => header.map((h) => escape(e[h])).join(',')),
    ].join('\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `th-labs-community-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <p className="page-intro">
        People who joined the community from the public landing page form. Joining is public;
        reading and editing is staff-only, and only a SUPERADMIN can delete an entry.
      </p>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="spacer" />
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
          Export CSV
        </button>
        <button className="btn" onClick={members.refetch} disabled={members.loading}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      {members.error && <ErrorState error={members.error} onRetry={members.refetch} />}

      {members.initialLoading ? (
        <TableSkeleton rows={6} cols={3} />
      ) : (
        !members.error && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={String(e.id)}>
                    <td>
                      <div className="cell-user">
                        <div className="avatar">{initialsOf(e.userName, e.email)}</div>
                        <span className="cell-user-name">{String(e.userName ?? '—')}</span>
                      </div>
                    </td>
                    <td>{String(e.email ?? '—')}</td>
                    <td className="nowrap" title={formatDateTime(e.createdAt)}>
                      {relativeTime(e.createdAt)}
                    </td>
                    <td className="actions">
                      <button
                        className="btn btn-icon"
                        onClick={() => setEditing(e)}
                        title="Edit member"
                      >
                        <IconEdit />
                      </button>
                      {isSuperAdmin && (
                        <button
                          className="btn btn-icon danger"
                          onClick={() => setDeleting(e)}
                          title="Remove member (SUPERADMIN)"
                        >
                          <IconTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!visible.length && (
              <EmptyState
                title={search ? 'No matches' : 'No community members yet'}
                message={
                  search
                    ? 'Try a different search term.'
                    : 'Entries appear here when people join from the landing page.'
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

      {!isSuperAdmin && (
        <InfoNote title="Deleting requires SUPERADMIN">
          Your role can list and edit community members. Removal is restricted to SUPERADMIN, so
          the delete action is hidden.
        </InfoNote>
      )}

      {editing && (
        <EditCommunityModal
          member={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            members.refetch()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Remove this community member?"
          destructive
          confirmLabel="Remove member"
          pending={remove.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              <strong style={{ color: 'var(--text)' }}>
                {String(deleting.userName || deleting.email)}
              </strong>{' '}
              ({String(deleting.email ?? '—')}) will be removed from the community list. This
              cannot be undone.
            </>
          }
        />
      )}
    </>
  )
}

function EditCommunityModal({
  member,
  onClose,
  onDone,
}: {
  member: CommunityMember
  onClose: () => void
  onDone: () => void
}) {
  const { toast, toastError } = useToast()
  const [userName, setUserName] = useState(String(member.userName ?? ''))
  const [email, setEmail] = useState(String(member.email ?? ''))

  const update = useMutation((input: UpdateCommunityInput) =>
    endpoints.updateCommunityMember(member.id, input),
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    // Both fields are optional on the PATCH body — send only what changed.
    const patch: UpdateCommunityInput = {}
    if (userName.trim() !== (member.userName ?? '')) patch.userName = userName.trim()
    if (email.trim() !== (member.email ?? '')) patch.email = email.trim()

    if (!Object.keys(patch).length) {
      onClose()
      return
    }

    try {
      await update.mutate(patch)
      toast('Community member updated')
      onDone()
    } catch (err) {
      toastError(err, 'Could not update the member')
    }
  }

  return (
    <Modal
      title="Edit community member"
      subtitle={`PATCH /v1/community/${member.id} — only changed fields are sent.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={update.pending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            form="edit-community-form"
            type="submit"
            disabled={update.pending}
          >
            {update.pending && <span className="spinner" />}
            Save changes
          </button>
        </>
      }
    >
      <form id="edit-community-form" onSubmit={onSubmit}>
        <Field label="Name">
          <input
            className="input"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  )
}
