import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Field } from '../components/ui'
import { IconAlert } from '../components/icons'

export function Login() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/'} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-head">
          <div className="brand-mark">TH</div>
          <h1>TH-Labs Studio</h1>
          <p>Sign in to the admin panel</p>
        </div>

        {error && (
          <div className="alert error" style={{ marginBottom: 14 }}>
            <IconAlert />
            <div className="alert-body">{error}</div>
          </div>
        )}

        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@th-labs.uz"
          />
        </Field>

        <Field label="Password">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
          {pending && <span className="spinner" />}
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="login-foot">Requires an ADMIN or SUPERADMIN account.</div>
      </form>
    </div>
  )
}
