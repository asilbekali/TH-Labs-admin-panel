import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiError,
  endpoints,
  refreshSession,
  setAccessToken,
  setSessionLostHandler,
} from '../lib/api'
import { STAFF_ROLES, type AuthUser, type Role } from '../lib/types'
import {
  forgetDefaultAdmin,
  hasDefaultAdminSession,
  isDefaultAdmin,
  makeDefaultAdminUser,
  matchesDefaultAdmin,
  rememberDefaultAdmin,
} from './fallbackAdmin'

interface AuthContextValue {
  user: AuthUser | null
  /** False until the boot-time refresh attempt has settled. */
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  isSuperAdmin: boolean
  /** Signed in with the built-in default account — no real API session. */
  isDefaultAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Thrown on login when the credentials are valid but the role is not staff. */
class NotStaffError extends Error {
  constructor(role: Role) {
    super(
      `This account has the ${role} role. The admin panel requires ADMIN or SUPERADMIN.`,
    )
    this.name = 'NotStaffError'
  }
}

function isStaff(role: unknown): role is Role {
  return typeof role === 'string' && STAFF_ROLES.includes(role as Role)
}

/** /auth/me has no documented shape — the user may be wrapped in an envelope. */
function extractUser(payload: unknown): AuthUser | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (typeof record.email === 'string' && record.role) return record as unknown as AuthUser
  for (const key of ['user', 'data']) {
    const nested = record[key]
    if (nested && typeof nested === 'object') {
      const n = nested as Record<string, unknown>
      if (typeof n.email === 'string') return n as unknown as AuthUser
    }
  }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  // Read by the session-lost handler, which is registered once and would
  // otherwise close over a stale `user`.
  const onDefaultAdmin = useRef(false)

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    onDefaultAdmin.current = false
    forgetDefaultAdmin()
  }, [])

  // Let the API client tear down the session when a refresh finally fails.
  useEffect(() => {
    setSessionLostHandler(() => {
      // The built-in admin has no token, so every API call 401s. Tearing the
      // session down on that would bounce it straight back to /login.
      if (onDefaultAdmin.current) return
      clearSession()
    })
    return () => setSessionLostHandler(null)
  }, [clearSession])

  // On boot, try to resume from the httpOnly refresh cookie. A 401 here just
  // means "not signed in" — it is the expected path for a fresh visitor, and
  // refreshSession() resolves to null rather than throwing.
  //
  // No "run once" ref guard here: under StrictMode the effect is invoked twice,
  // and a ref guard would make the second pass bail out while the first pass
  // had already been cancelled by its own cleanup — leaving `ready` false
  // forever. refreshSession() de-duplicates in-flight calls, so letting both
  // passes run shares a single request and only the live one commits state.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const session = await refreshSession()
      if (cancelled) return

      if (session && isStaff(session.user?.role)) {
        setUser(session.user)
      } else if (session) {
        // Signed in, but as a non-staff user — don't grant panel access.
        clearSession()
      } else if (hasDefaultAdminSession()) {
        // No backend session, but this tab signed in as the built-in admin.
        onDefaultAdmin.current = true
        setUser(makeDefaultAdminUser())
      }
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    let res: Awaited<ReturnType<typeof endpoints.login>>
    try {
      res = await endpoints.login(email, password)
    } catch (err) {
      // The backend has no such admin (or is unreachable). Fall back to the
      // built-in default account if that is what was typed; otherwise the
      // original failure is the honest answer.
      if (matchesDefaultAdmin(email, password)) {
        setAccessToken(null)
        onDefaultAdmin.current = true
        rememberDefaultAdmin()
        setUser(makeDefaultAdminUser())
        return
      }
      throw err
    }

    onDefaultAdmin.current = false
    forgetDefaultAdmin()
    setAccessToken(res.accessToken)

    // Prefer the login body, but fall back to /auth/me if it omitted the role.
    let nextUser: AuthUser | null = res.user ?? null
    if (!nextUser?.role) {
      try {
        nextUser = extractUser(await endpoints.me())
      } catch {
        /* fall through to the guard below */
      }
    }

    if (!nextUser || !isStaff(nextUser.role)) {
      setAccessToken(null)
      throw new NotStaffError((nextUser?.role as Role) ?? 'USER')
    }

    setUser(nextUser)
  }, [])

  const logout = useCallback(async () => {
    // Nothing to revoke server-side for the built-in admin.
    if (onDefaultAdmin.current) {
      clearSession()
      return
    }

    try {
      await endpoints.logout()
    } catch (err) {
      // A failed logout still clears the client; the cookie will expire on its
      // own. Only surface genuinely unexpected failures.
      if (!(err instanceof ApiError)) console.warn('Logout request failed', err)
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      login,
      logout,
      isSuperAdmin: user?.role === 'SUPERADMIN',
      isDefaultAdmin: isDefaultAdmin(user),
    }),
    [user, ready, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
