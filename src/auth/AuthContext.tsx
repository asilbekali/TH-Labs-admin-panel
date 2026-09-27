import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { isStaffRole, type AuthUser, type Role } from '../lib/types'

interface AuthContextValue {
  user: AuthUser | null
  /** False until the boot-time refresh attempt has settled. */
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** True for SUPERADMIN only — the role gate on role changes, admin CRUD and deletes. */
  isSuperAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Thrown on login when the credentials are valid but the role is not staff.
 *
 * The API would happily issue this session — it is a real account — so the
 * refusal is the panel's own, and it has to be explicit rather than a broken
 * dashboard full of 403s.
 */
class NotStaffError extends Error {
  constructor(role: Role | string) {
    super(
      `This account has the ${role} role. The admin panel requires ADMIN or SUPERADMIN.`,
    )
    this.name = 'NotStaffError'
  }
}

/** /auth/me is undocumented — the user may arrive wrapped in an envelope. */
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

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
  }, [])

  // Let the API client tear down the session when a refresh finally fails.
  useEffect(() => {
    setSessionLostHandler(clearSession)
    return () => setSessionLostHandler(null)
  }, [clearSession])

  // On boot, resume from the httpOnly refresh cookie. A 401 here just means
  // "not signed in" — the expected path for a fresh visitor — and
  // refreshSession() resolves to null rather than throwing.
  //
  // No "run once" ref guard: under StrictMode the effect is invoked twice, and
  // a ref guard would make the second pass bail out while the first had
  // already been cancelled by its own cleanup, leaving `ready` false forever.
  // refreshSession() de-duplicates in-flight calls, so letting both passes run
  // shares a single request and only the live one commits state.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const session = await refreshSession()
      if (cancelled) return

      if (session && isStaffRole(session.user?.role)) {
        setUser(session.user)
      } else if (session) {
        // A valid session, but not a staff one — don't grant panel access.
        clearSession()
      }
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const res = await endpoints.login(email, password)

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

    if (!nextUser || !isStaffRole(nextUser.role)) {
      // Drop the token rather than hold a session the panel refuses to use.
      setAccessToken(null)
      throw new NotStaffError((nextUser?.role as Role) ?? 'USER')
    }

    setUser(nextUser)
  }, [])

  const logout = useCallback(async () => {
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
