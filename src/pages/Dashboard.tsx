import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { endpoints } from '../lib/api'
import { useQuery } from '../lib/useApi'
import { formatDateTime, initialsOf, isWithinDays, relativeTime } from '../lib/format'
import { buildActivity } from '../lib/activity'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, ErrorState, RoleBadge } from '../components/ui'
import {
  IconActivity,
  IconCoin,
  IconList,
  IconShield,
  IconUsers,
} from '../components/icons'
import type { ApiUser } from '../lib/types'

export function Dashboard() {
  const { user, isSuperAdmin } = useAuth()

  const users = useQuery((signal) => endpoints.users(signal))
  const waitList = useQuery((signal) => endpoints.waitList(signal))
  const plans = useQuery((signal) => endpoints.plans(signal))
  const admins = useQuery(
    async (signal) => (isSuperAdmin ? endpoints.admins(signal) : []),
    [isSuperAdmin],
  )

  const rows: ApiUser[] = useMemo(() => users.data ?? [], [users.data])

  const stats = useMemo(() => {
    const newThisWeek = rows.filter((u) => isWithinDays(u.createdAt, 7)).length
    const staff = rows.filter((u) => u.role === 'ADMIN' || u.role === 'SUPERADMIN').length
    return { newThisWeek, staff }
  }, [rows])

  const recent = useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) =>
            new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime(),
        )
        .slice(0, 6),
    [rows],
  )

  const recentActivity = useMemo(
    () =>
      buildActivity({
        users: rows,
        admins: admins.data ?? [],
        waitList: waitList.data ?? [],
      }).slice(0, 6),
    [rows, admins.data, waitList.data],
  )

  const activePlans = (plans.data?.plans ?? []).filter((p) => p.active).length

  return (
    <>
      <p className="page-intro">
        Welcome back, {user?.name?.split(' ')[0] || user?.email}. Here's the current state of the
        platform.
      </p>

      <div className="stat-grid section">
        <Stat
          label="Total users"
          value={users.initialLoading ? null : rows.length}
          hint={`${stats.newThisWeek} joined in the last 7 days`}
          icon={<IconUsers />}
        />
        <Stat
          label="Wait list"
          value={waitList.initialLoading ? null : (waitList.data?.length ?? 0)}
          hint="People awaiting early access"
          icon={<IconList />}
          tone="green"
        />
        <Stat
          label="Staff accounts"
          value={users.initialLoading ? null : stats.staff}
          hint={isSuperAdmin ? `${admins.data?.length ?? 0} in the admin table` : 'ADMIN + SUPERADMIN'}
          icon={<IconShield />}
          tone="violet"
        />
        <Stat
          label="Active plans"
          value={plans.initialLoading ? null : activePlans}
          hint={`${plans.data?.plans?.length ?? 0} total in catalogue`}
          icon={<IconCoin />}
          tone="amber"
        />
      </div>

      {users.error && <ErrorState error={users.error} onRetry={users.refetch} />}

      <div className="section">
        <div className="section-head">
          <h2>Newest users</h2>
          <div className="spacer" />
          <Link className="btn btn-sm" to="/users">
            View all
          </Link>
        </div>

        <div className="table-wrap">
          {users.initialLoading ? (
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 16 }} />
              ))}
            </div>
          ) : recent.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((u) => (
                  <tr key={String(u.id)}>
                    <td>
                      <Link className="cell-user" to={`/users/${u.id}`}>
                        <div className="avatar">{initialsOf(u.name, u.email)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-user-name">{u.name || '—'}</div>
                          <div className="cell-user-email">{u.email}</div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="nowrap" title={formatDateTime(u.createdAt)}>
                      {relativeTime(u.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No users yet" />
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Recent activity</h2>
          <div className="spacer" />
          <Link className="btn btn-sm" to="/activity">
            Full log
          </Link>
        </div>

        <div className="card">
          {recentActivity.length ? (
            <div className="feed">
              {recentActivity.map((e) => (
                <div className="feed-item" key={e.id}>
                  <div className="feed-icon stat-icon">
                    <IconActivity />
                  </div>
                  <div className="feed-body">
                    <div className="feed-title">{e.title}</div>
                    {e.subtitle && <div className="feed-meta">{e.subtitle}</div>}
                  </div>
                  <div className="feed-time" title={formatDateTime(e.timestamp)}>
                    {relativeTime(e.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing to show yet" />
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
  value: number | null
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
      {value === null ? (
        <div className="skeleton" style={{ height: 28, width: 70 }} />
      ) : (
        <div className="stat-value">{value.toLocaleString()}</div>
      )}
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}
