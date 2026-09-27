import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
// The React entry point, not /next — this is a Vite SPA. Mounted here rather
// than inside Layout so the login screen is measured too; it only injects its
// script in a production build and no-ops elsewhere.
import { Analytics } from '@vercel/analytics/react'
import { beforeSend } from './lib/analytics'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { ToastProvider } from './components/Toast'
import { Layout } from './components/Layout'
import { Activity } from './pages/Activity'
import { Admins } from './pages/Admins'
import { Billing } from './pages/Billing'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { UserDetail } from './pages/UserDetail'
import { Users } from './pages/Users'
import { Community } from './pages/Community'
import { Feedback } from './pages/Feedback'
import { FeedbackInboxProvider } from './lib/feedbackInbox'

/**
 * Blocks the app until the boot-time refresh has settled, so a signed-in user
 * reloading a deep link isn't bounced to /login for a frame.
 */
function RequireAuth() {
  const { user, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="center-screen">
        <span className="spinner" style={{ width: 22, height: 22, color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>Restoring session…</span>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // Inside the auth gate so the untriaged poll only ever runs for a signed-in
  // staff session — mounted above Layout, which renders the nav badge.
  return (
    <FeedbackInboxProvider>
      <Layout />
    </FeedbackInboxProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route index element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="users/:id" element={<UserDetail />} />
              <Route path="admins" element={<Admins />} />
              <Route path="community" element={<Community />} />
              <Route path="feedback" element={<Feedback />} />
              <Route path="billing" element={<Billing />} />
              <Route path="activity" element={<Activity />} />
            </Route>
            <Route path="/wait-list" element={<Navigate to="/community" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Analytics beforeSend={beforeSend} />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
