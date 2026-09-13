/**
 * Built-in default admin.
 *
 * If the backend has no admin account to sign in with — the credentials are
 * rejected, or the API is unreachable entirely — signing in with these
 * credentials drops into the panel as a local SUPERADMIN instead.
 *
 * This is a *client-side* session: there is no access token behind it, so
 * every call to the real API will still fail. It exists so the panel can be
 * opened and navigated when no backend admin exists yet, not as a way to
 * administer live data. Anyone who can load the bundle can read these
 * credentials, so leave VITE_ENABLE_DEFAULT_ADMIN unset (or 'false') on a
 * deployment that talks to a real backend.
 */

import type { AuthUser } from '../lib/types'

export const DEFAULT_ADMIN_EMAIL =
  import.meta.env.VITE_DEFAULT_ADMIN_EMAIL || 'super@gmail.com'

export const DEFAULT_ADMIN_PASSWORD =
  import.meta.env.VITE_DEFAULT_ADMIN_PASSWORD || 'iamadmin'

/** Off only when explicitly disabled, so the default works out of the box. */
export const DEFAULT_ADMIN_ENABLED =
  String(import.meta.env.VITE_ENABLE_DEFAULT_ADMIN ?? 'true').toLowerCase() !== 'false'

const STORAGE_KEY = 'th-labs.default-admin-session'

export function matchesDefaultAdmin(email: string, password: string): boolean {
  if (!DEFAULT_ADMIN_ENABLED) return false
  return (
    email.trim().toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase() &&
    password === DEFAULT_ADMIN_PASSWORD
  )
}

export function makeDefaultAdminUser(): AuthUser {
  return {
    id: 0,
    email: DEFAULT_ADMIN_EMAIL,
    name: 'Default Admin',
    role: 'SUPERADMIN',
    createdAt: new Date().toISOString(),
  }
}

/** True for the local session above — not for a real SUPERADMIN from the API. */
export function isDefaultAdmin(user: AuthUser | null): boolean {
  return !!user && user.id === 0 && user.email === DEFAULT_ADMIN_EMAIL
}

/* Persisted in sessionStorage so a page reload doesn't bounce back to /login;
 * there is no refresh cookie to resume from. Storage can throw (private mode,
 * blocked cookies), and a failure there only costs reload persistence. */

export function rememberDefaultAdmin() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* non-fatal */
  }
}

export function forgetDefaultAdmin() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* non-fatal */
  }
}

export function hasDefaultAdminSession(): boolean {
  if (!DEFAULT_ADMIN_ENABLED) return false
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
