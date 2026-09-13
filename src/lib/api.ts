/**
 * Thin API client for the TH-LABS backend.
 *
 * Auth model, from the spec:
 *  - POST /auth/login returns a short-lived accessToken in the body and sets a
 *    long-lived refresh token as an httpOnly cookie.
 *  - POST /auth/refresh rotates that cookie and returns a fresh accessToken.
 *
 * So the access token lives in memory only (never localStorage — an XSS there
 * would hand over a bearer token), and the session survives reloads by calling
 * refresh on boot. Every request therefore needs credentials: 'include'.
 */

import type { AuthResponse } from './types'

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/* -------------------------------------------------------------------------- */
/* Access token (module-scoped, in memory)                                     */
/* -------------------------------------------------------------------------- */

let accessToken: string | null = null
let onSessionLost: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

/** Registered by AuthProvider so a failed refresh can bounce us to /login. */
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn
}

/* -------------------------------------------------------------------------- */
/* Refresh, de-duplicated                                                      */
/* -------------------------------------------------------------------------- */

let refreshInFlight: Promise<AuthResponse | null> | null = null

/**
 * Rotate the refresh cookie for a new access token.
 *
 * Concurrent callers share one in-flight request — otherwise a page that fires
 * four requests at mount would race four rotations against each other and all
 * but one would be rejected as a reused token.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null
      const data = (await res.json()) as AuthResponse
      if (!data?.accessToken) return null
      accessToken = data.accessToken
      return data
    } catch {
      return null
    } finally {
      // Cleared on the next tick so callers awaiting this promise all resolve
      // from the same run before a new one can start.
      setTimeout(() => {
        refreshInFlight = null
      }, 0)
    }
  })()

  return refreshInFlight
}

/* -------------------------------------------------------------------------- */
/* Core request                                                                */
/* -------------------------------------------------------------------------- */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** Internal: prevents a refresh loop when the refresh itself 401s. */
  _retried?: boolean
  /** Skip the bearer header entirely (login, public endpoints). */
  anonymous?: boolean
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body
  if (body && typeof body === 'object') {
    const m = (body as Record<string, unknown>).message
    if (typeof m === 'string') return m
    // Nest's ValidationPipe returns message as string[].
    if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(', ')
  }
  return fallback
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, anonymous, _retried } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (!anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // An expired access token is the common case, not an error — rotate once and
  // replay the request. Only once, so a genuinely dead session can't spin.
  if (res.status === 401 && !anonymous && !_retried) {
    const refreshed = await refreshSession()
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retried: true })
    }
    accessToken = null
    onSessionLost?.()
  }

  const payload = await parseBody(res)

  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(payload, `Request failed (${res.status})`), payload)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

import type {
  Admin,
  ApiUser,
  CreateAdminInput,
  CreateUserInput,
  PlansResponse,
  UpdateAdminInput,
  UpdateUserInput,
  UsersCountResponse,
  WaitListEntry,
} from './types'

/**
 * Several list endpoints are undocumented in the spec and may return either a
 * bare array or an envelope like { users: [...] }. Rather than guess, pull the
 * first array we find.
 */
export function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      if (Array.isArray(value)) return value as T[]
    }
  }
  return []
}

export const endpoints = {
  // auth
  login: (email: string, password: string) =>
    apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    }),
  logout: () => apiRequest<unknown>('/auth/logout', { method: 'POST' }),
  me: (signal?: AbortSignal) => api.get<AuthUserResponse>('/auth/me', signal),

  // users
  usersCount: (signal?: AbortSignal) => api.get<UsersCountResponse>('/users/all-users', signal),
  users: async (signal?: AbortSignal) =>
    unwrapList<ApiUser>(await api.get<unknown>('/users/all-users-data', signal)),
  user: (id: number | string, signal?: AbortSignal) =>
    api.get<ApiUser>(`/users/${id}`, signal),
  createUser: (input: CreateUserInput) => api.post<unknown>('/users/create-user', input),
  updateUser: (id: number | string, input: UpdateUserInput) =>
    api.patch<unknown>(`/users/${id}`, input),
  deleteUser: (id: number | string) => api.delete<unknown>(`/users/${id}`),

  // admins (SUPERADMIN only)
  admins: async (signal?: AbortSignal) =>
    unwrapList<Admin>(await api.get<unknown>('/admin', signal)),
  createAdmin: (input: CreateAdminInput) => api.post<Admin>('/admin', input),
  updateAdmin: (id: number, input: UpdateAdminInput) => api.patch<Admin>(`/admin/${id}`, input),
  deleteAdmin: (id: number) => api.delete<{ message: string }>(`/admin/${id}`),

  // wait list
  waitList: async (signal?: AbortSignal) =>
    unwrapList<WaitListEntry>(await api.get<unknown>('/wait-list', signal)),
  deleteWaitListEntry: (id: number | string) => api.delete<unknown>(`/wait-list/${id}`),

  // payments
  plans: (signal?: AbortSignal) => api.get<PlansResponse>('/payments/plans', signal),
  subscription: (signal?: AbortSignal) => api.get<unknown>('/payments/subscription', signal),
  credits: (page = 1, limit = 20, signal?: AbortSignal) =>
    api.get<unknown>(`/payments/credits?page=${page}&limit=${limit}`, signal),
  paymentHistory: (page = 1, limit = 20, signal?: AbortSignal) =>
    api.get<unknown>(`/payments/history?page=${page}&limit=${limit}`, signal),
}

/** /auth/me is undocumented; it returns the user, possibly wrapped. */
type AuthUserResponse = Record<string, unknown>
