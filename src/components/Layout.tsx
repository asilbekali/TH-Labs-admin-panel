import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { initialsOf } from '../lib/format'
import {
  IconActivity,
  IconAlert,
  IconCard,
  IconDashboard,
  IconList,
  IconLogout,
  IconMenu,
  IconMoon,
  IconShield,
  IconSun,
  IconUsers,
} from './icons'

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/users', label: 'Users', icon: IconUsers },
  { to: '/admins', label: 'Admins', icon: IconShield, superAdminOnly: true },
  { to: '/wait-list', label: 'Wait list', icon: IconList },
  { to: '/billing', label: 'Billing & plans', icon: IconCard },
  { to: '/activity', label: 'Activity log', icon: IconActivity },
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
  const { user, logout, isSuperAdmin, isDefaultAdmin } = useAuth()
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
          {items.map(({ to, label, icon: Icon, end }) => (
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
          {isDefaultAdmin && (
            <div className="alert warn" style={{ marginBottom: 16 }}>
              <IconAlert />
              <div className="alert-body">
                <strong>Signed in with the default admin account.</strong> The backend
                did not accept these credentials, so this is a local session only —
                pages that read or write live data will fail until you sign in with a
                real ADMIN or SUPERADMIN account.
              </div>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
