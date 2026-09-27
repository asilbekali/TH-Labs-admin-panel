import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { endpoints, isMissingRoute } from '../lib/api'
import { useQuery } from '../lib/useApi'
import { useFeedbackInbox } from '../lib/feedbackInbox'
import { initialsOf } from '../lib/format'
import { Badge } from './ui'
import {
  IconActivity,
  IconCard,
  IconDashboard,
  IconList,
  IconLogout,
  IconMenu,
  IconMessage,
  IconMoon,
  IconPulse,
  IconShield,
  IconSun,
  IconUsers,
} from './icons'

interface NavItem {
  to: string
  label: string
  icon: (p: { className?: string }) => React.ReactElement
  end?: boolean
  superAdminOnly?: boolean
  /** Renders the untriaged-feedback count beside the label. */
  badge?: 'feedback'
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/users', label: 'Users', icon: IconUsers },
  { to: '/feedback', label: 'Feedback', icon: IconMessage, badge: 'feedback' },
  { to: '/community', label: 'Community', icon: IconList },
  { to: '/billing', label: 'Billing', icon: IconCard },
  { to: '/activity', label: 'Activity log', icon: IconActivity },
  { to: '/admins', label: 'Admin records', icon: IconShield, superAdminOnly: true },
]

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('th-admin-theme') as 'dark' | 'light') || 'dark',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('th-admin-theme', theme)
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}

export function Layout() {
  const { user, logout, isSuperAdmin } = useAuth()
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)

  const items = NAV.filter((item) => !item.superAdminOnly || isSuperAdmin)
  const current = items.find((i) =>
    i.end ? location.pathname === i.to : location.pathname.startsWith(i.to),
  )

  
  return (
    <div className="shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">TH</div>
          <div>
            <div className="brand-name">TH-Labs Studio</div>
            <div className="brand-sub">Admin panel</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-label">Manage</div>
          {items.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              // Dismiss the mobile drawer from the navigation itself rather
              // than reacting to the route change after the fact.
              onClick={() => setNavOpen(false)}
            >
              <Icon />
              {label}
              {badge === 'feedback' && <UntriagedCount />}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip" style={{ cursor: 'default' }}>
            <div className="avatar">{initialsOf(user?.name, user?.email)}</div>
            <div className="user-chip-meta">
              <div className="user-chip-name">{user?.name || user?.email}</div>
              <div className="user-chip-role">{user?.role}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-block btn-sm" onClick={() => void logout()}>
            <IconLogout />
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="btn btn-icon sidebar-toggle"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            <IconMenu />
          </button>
          <h1>{current?.label ?? 'Admin'}</h1>
          <div className="topbar-actions">
            <ModeBadge />
            <HealthBadge />
            <button
              className="btn btn-icon"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Untriaged feedback                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The count of feedback nobody has looked at, on the nav item itself.
 *
 * This is the whole point of the inbox: a user writing in has to be something
 * staff *notice*, not something they remember to go and check. So it sits in
 * the sidebar on every screen, and reads the shared count so it can never
 * disagree with the inbox it links to.
 *
 * Renders nothing at zero, and nothing while the count is unknown — a "0" badge
 * is noise, and a badge invented from a failed request is a lie.
 */
function UntriagedCount() {
  const { count } = useFeedbackInbox()

  if (count == null || count <= 0) return null

  return (
    <span
      className="nav-count"
      title={`${count} feedback message${count === 1 ? '' : 's'} nobody has triaged yet`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Topbar indicators                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Test mode must never be a surprise, so it is a persistent badge rather than
 * something you only see on the billing screen. Silent when the overview is
 * unavailable — a missing endpoint is not evidence of either mode.
 */
function ModeBadge() {
  const overview = useQuery((signal) => endpoints.billingOverview(signal))
  const mode = overview.data?.mode

  if (!mode) return null

  return (
    <Badge tone={mode === 'live' ? 'green' : 'amber'}>
      <span className="dot" />
      {String(mode).toUpperCase()}
    </Badge>
  )
}

/** Public endpoint — a cheap at-a-glance read on the API and the pipeline. */
function HealthBadge() {
  const health = useQuery((signal) => endpoints.health(signal))

  if (health.initialLoading || isMissingRoute(health.error)) return null

  if (health.error) {
    return (
      <Badge tone="red">
        <IconPulse />
        API unreachable
      </Badge>
    )
  }

  const data = health.data
  const tone = data?.mode === 'ok' ? 'green' : data?.database === 'up' ? 'amber' : 'red'

  return (
    <Badge tone={tone} >
      <IconPulse />
      <span title={`database ${data?.database} · pipeline ${data?.pipeline}`}>
        {data?.mode ?? 'unknown'}
      </span>
    </Badge>
  )
}
