import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { useQuery } from '../lib/useApi'
import { ROLES, type MailRecipient, type Role } from '../lib/types'
import { ComposeForm } from '../components/Compose'
import { ErrorState, RoleBadge, TableSkeleton } from '../components/ui'
import { IconList, IconSearch, IconUsers, IconX } from '../components/icons'

type Source = 'users' | 'community' | 'paste'

const EMAIL_PATTERN = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g

interface Candidate extends MailRecipient {
  key: string
  role?: Role
}

const keyOf = (email: string) => email.trim().toLowerCase()

/**
 * Write to one person or a hand-picked group: registered users, community
 * signups, or addresses pasted in. Each recipient gets their own copy from
 * the API, so the list itself is never exposed to anyone on it.
 */
export function Mail() {
  const [params] = useSearchParams()

  // `?to=` is how the Users table's mail button lands here pre-filled.
  const [selected, setSelected] = useState<Map<string, MailRecipient>>(() => {
    const map = new Map<string, MailRecipient>()
    for (const email of params.getAll('to')) {
      if (email.includes('@')) map.set(keyOf(email), { email })
    }
    return map
  })
  const [source, setSource] = useState<Source>('users')

  const recipients = useMemo(() => [...selected.values()], [selected])

  function add(list: MailRecipient[]) {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const r of list) next.set(keyOf(r.email), r)
      return next
    })
  }

  function remove(keys: string[]) {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const k of keys) next.delete(k)
      return next
    })
  }

  return (
    <>
      <p className="page-intro">
        Email users from the panel — a reply, an announcement, a heads-up. Every recipient gets their
        own branded copy, so nobody sees who else it went to. Any ADMIN or SUPERADMIN can send.
      </p>

      <div className="mail-layout">
        <section className="card card-pad">
          <div className="section-head">
            <h2>Recipients</h2>
            <div className="spacer" />
            {recipients.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Map())}>
                Clear all
              </button>
            )}
          </div>

          <div className="recipient-chips">
            {recipients.length === 0 && (
              <span className="text-faint">Pick people below, or paste addresses.</span>
            )}
            {recipients.slice(0, 40).map((r) => (
              <span className="recipient" key={keyOf(r.email)} title={r.email}>
                {r.name || r.email}
                <button
                  type="button"
                  aria-label={`Remove ${r.email}`}
                  onClick={() => remove([keyOf(r.email)])}
                >
                  <IconX />
                </button>
              </span>
            ))}
            {recipients.length > 40 && (
              <span className="text-faint">+{recipients.length - 40} more</span>
            )}
          </div>

          <div className="segmented" role="tablist">
            <button
              role="tab"
              aria-selected={source === 'users'}
              className={source === 'users' ? 'on' : ''}
              onClick={() => setSource('users')}
            >
              <IconUsers /> Users
            </button>
            <button
              role="tab"
              aria-selected={source === 'community'}
              className={source === 'community' ? 'on' : ''}
              onClick={() => setSource('community')}
            >
              <IconList /> Community
            </button>
            <button
              role="tab"
              aria-selected={source === 'paste'}
              className={source === 'paste' ? 'on' : ''}
              onClick={() => setSource('paste')}
            >
              Paste addresses
            </button>
          </div>

          {source === 'users' && (
            <UserPicker selected={selected} onAdd={add} onRemove={remove} />
          )}
          {source === 'community' && (
            <CommunityPicker selected={selected} onAdd={add} onRemove={remove} />
          )}
          {source === 'paste' && <PastePicker onAdd={add} />}
        </section>

        <section className="card card-pad">
          <div className="section-head">
            <h2>Message</h2>
          </div>
          <ComposeForm recipients={recipients} />
        </section>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

interface PickerProps {
  selected: Map<string, MailRecipient>
  onAdd: (list: MailRecipient[]) => void
  onRemove: (keys: string[]) => void
}

function UserPicker(props: PickerProps) {
  const users = useQuery((signal) => endpoints.users(signal))
  const [role, setRole] = useState<'ALL' | Role>('ALL')

  const candidates = useMemo<Candidate[]>(
    () =>
      (users.data ?? [])
        .filter((u) => u.email && (role === 'ALL' || u.role === role))
        .map((u) => ({ key: keyOf(u.email), email: u.email, name: u.name, role: u.role })),
    [users.data, role],
  )

  if (users.error) return <ErrorState error={users.error} onRetry={users.refetch} />
  if (users.initialLoading) return <TableSkeleton rows={5} cols={2} />

  return (
    <CandidateList
      {...props}
      candidates={candidates}
      filter={
        <select
          className="select"
          style={{ width: 'auto' }}
          value={role}
          onChange={(e) => setRole(e.target.value as 'ALL' | Role)}
          aria-label="Filter by role"
        >
          <option value="ALL">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      }
    />
  )
}

function CommunityPicker(props: PickerProps) {
  const community = useQuery((signal) => endpoints.community(signal))

  const candidates = useMemo<Candidate[]>(
    () =>
      (community.data ?? [])
        .filter((m) => typeof m.email === 'string' && m.email)
        .map((m) => ({
          key: keyOf(m.email as string),
          email: m.email as string,
          name: m.userName,
        })),
    [community.data],
  )

  if (community.error) return <ErrorState error={community.error} onRetry={community.refetch} />
  if (community.initialLoading) return <TableSkeleton rows={5} cols={2} />

  return <CandidateList {...props} candidates={candidates} />
}

function CandidateList({
  candidates,
  selected,
  onAdd,
  onRemove,
  filter,
}: PickerProps & { candidates: Candidate[]; filter?: React.ReactNode }) {
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (c) => c.email.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q),
    )
  }, [candidates, search])

  const allOn = visible.length > 0 && visible.every((c) => selected.has(c.key))

  return (
    <>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <div className="search">
          <IconSearch />
          <input
            className="input"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {filter}
        <button
          className="btn btn-sm"
          disabled={!visible.length}
          onClick={() =>
            allOn ? onRemove(visible.map((c) => c.key)) : onAdd(visible.map(stripKey))
          }
        >
          {allOn ? 'Unselect' : 'Select'} {visible.length}
        </button>
      </div>

      <div className="pick-list">
        {visible.slice(0, 300).map((c) => (
          <label key={c.key} className="pick-row">
            <input
              type="checkbox"
              checked={selected.has(c.key)}
              onChange={(e) => (e.target.checked ? onAdd([stripKey(c)]) : onRemove([c.key]))}
            />
            <span className="pick-main">
              <span className="pick-name">{c.name || '—'}</span>
              <span className="pick-email">{c.email}</span>
            </span>
            {c.role && <RoleBadge role={c.role} />}
          </label>
        ))}
        {!visible.length && <div className="text-faint pick-empty">Nobody matches.</div>}
        {visible.length > 300 && (
          <div className="text-faint pick-empty">
            Showing 300 of {visible.length} — search to narrow, or use “Select {visible.length}”.
          </div>
        )}
      </div>
    </>
  )
}

function stripKey({ email, name }: Candidate): MailRecipient {
  return { email, name }
}

function PastePicker({ onAdd }: { onAdd: (list: MailRecipient[]) => void }) {
  const [text, setText] = useState('')
  const found = useMemo(() => [...new Set(text.match(EMAIL_PATTERN) ?? [])], [text])

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        className="input"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'ada@example.com, alan@example.com\nor one per line'}
      />
      <div className="compose-foot">
        <span className="text-faint">
          {found.length} address{found.length === 1 ? '' : 'es'} found
        </span>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          disabled={!found.length}
          onClick={() => {
            onAdd(found.map((email) => ({ email })))
            setText('')
          }}
        >
          Add {found.length || ''}
        </button>
      </div>
    </div>
  )
}
