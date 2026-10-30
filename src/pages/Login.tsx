import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Field } from '../components/ui'
import { BrandMark } from '../components/Logo'
import { useToast } from '../components/Toast'
import { IconAlert, IconEye, IconEyeOff } from '../components/icons'

export function Login() {
  const { user, login } = useAuth()
  const { toast } = useToast()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      const me = await login(email.trim(), password)
      const first = (me.name || me.email).split(/[\s@]/)[0]
      toast(
        me.role === 'SUPERADMIN'
          ? `Welcome back, ${first} — super admin, full access`
          : `Welcome back, ${first} — admin access`,
      )
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
          <BrandMark />
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
          <div className="input-with-action">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>
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
