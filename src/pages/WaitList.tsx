import { useMemo, useState } from 'react'
import { endpoints } from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { formatDateTime, initialsOf, relativeTime } from '../lib/format'
import type { WaitListEntry } from '../lib/types'
import { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'
import { EmptyState, ErrorState, Pagination, TableSkeleton } from '../components/ui'
import { IconRefresh, IconSearch, IconTrash } from '../components/icons'

export function WaitList() {
  const { toast, toastError } = useToast()
  const entries = useQuery((signal) => endpoints.waitList(signal))
  const remove = useMutation((id: number | string) => endpoints.deleteWaitListEntry(id))

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [deleting, setDeleting] = useState<WaitListEntry | null>(null)

  const filtered = useMemo(() => {
    const rows = entries.data ?? []
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
  }, [entries.data, search])

  const pageCount = Math.ceil(filtered.length / pageSize)
  const safePage = Math.min(page, Math.max(pageCount, 1))
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutate(deleting.id)
      toast('Wait list entry removed')
      setDeleting(null)
      entries.refetch()
    } catch (err) {
      toastError(err, 'Could not remove the entry')
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
    a.download = `th-labs-wait-list-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <p className="page-intro">
        People who signed up for early access via the public wait list form. The API exposes list,
        read and delete — there are no editable fields on a wait list entry, so entries are
        read-only here apart from removal.
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
        <button className="btn" onClick={entries.refetch} disabled={entries.loading}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      {entries.error && <ErrorState error={entries.error} onRetry={entries.refetch} />}

      {entries.initialLoading ? (
        <TableSkeleton rows={6} cols={3} />
      ) : (
        !entries.error && (
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
                        className="btn btn-icon danger"
                        onClick={() => setDeleting(e)}
                        title="Remove entry"
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
                title={search ? 'No matches' : 'Wait list is empty'}
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

      {deleting && (
        <ConfirmDialog
          title="Remove wait list entry?"
          destructive
          confirmLabel="Remove entry"
          pending={remove.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              <strong style={{ color: 'var(--text)' }}>
                {String(deleting.userName || deleting.email)}
              </strong>{' '}
              will be removed from the wait list.
            </>
          }
        />
      )}
    </>
  )
}
