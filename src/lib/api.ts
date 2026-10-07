/**
 * Thin API client for the TH-LABS account API.
 *
 * Auth model (cookie + bearer hybrid):
 *  - POST /auth/login returns a short-lived accessToken in the body and sets a
 *    long-lived refresh token as an httpOnly cookie scoped to /v1/auth.
 *  - POST /auth/refresh rotates that cookie and returns a fresh accessToken.
 *
 * So the access token lives in memory only (never localStorage — an XSS there
 * would hand over a bearer token), and the session survives reloads by calling
 * refresh on boot. Every request therefore needs credentials: 'include', or
 * the cookie never travels and the admin is logged out on every reload.
 *
 * Two things must be true on the SERVER or nothing works cross-origin, and
 * neither can be fixed from here:
 *  - the panel's origin is in the API's CORS_ORIGINS allowlist;
 *  - in production the panel is served over HTTPS, because the refresh cookie
 *    is SameSite=None; Secure there and the browser silently drops it otherwise.
 */

import type { AuthResponse } from './types'

/**
 * Defaults to the dev-server proxy at /api (rewritten to /v1), which keeps the
 * browser same-origin and sidesteps CORS entirely. Set VITE_API_BASE_URL to
 * point straight at an API whose allowlist already names this origin.
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export class ApiError extends Error {
  status: number
  body: unknown
  /** The full URL that was requested, so an error can name what it called. */
  url: string
  /**
   * True when the body is the API's own JSON error envelope
   * (`{ statusCode, message }`). False when some *other* host answered — a
   * static host's HTML 404, a proxy's error page — which is a completely
   * different fault with a completely different fix. See isMissingRoute.
   */
  fromApi: boolean

  constructor(
    status: number,
    message: string,
    body?: unknown,
    url = '',
    fromApi = true,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.url = url
    this.fromApi = fromApi
  }
}

/** The API's error envelope: `{ statusCode: number, message: ... }`. */
function looksLikeApiError(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  return typeof record.statusCode === 'number' || typeof record.message !== 'undefined'
}

/**
 * True when *the API* says a route is absent rather than forbidden.
 *
 * This must not fire on any old 404, and that distinction is the whole point.
 * `th-labs.uz` serves a Next.js app at the root and the API only under `/v1`,
 * so a panel pointed one segment wrong — at `/api/...` with no rewrite in
 * front of it, say — gets an **HTML 404 page** for every single call. Treating
 * that as "this API build has no logs endpoints" sends you off to redeploy a
 * backend that was never the problem, which is exactly the wrong afternoon.
 *
 * So a missing route requires a 404 carrying the API's own JSON envelope. An
 * HTML 404 is `isWrongApiBase` instead.
 *
 * Probe with a TWO-SEGMENT sibling (`/admin/logs/actions`, `/admin/logs/stats`)
 * rather than `/admin/logs` itself. On an API without the logs controller,
 * `/admin/logs` collides with `GET /admin/{id}`: unauthenticated that guard
 * returns 401, and authenticated it reaches the handler with id="logs" and
 * throws a 500. Neither is a 404, so the bare path cannot tell you the feature
 * is absent — but a two-segment sibling matches nothing and answers 404
 * cleanly.
 */
export function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.fromApi
}

/**
 * True when the request reached something that is not the API at all.
 *
 * The signature is a 404 whose body is not the API's JSON envelope — an HTML
 * document, most often. Every screen breaks at once when this happens, and the
 * fix is a deploy config (the `/api` rewrite, or VITE_API_BASE_URL), never the
 * backend.
 */
export function isWrongApiBase(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && !error.fromApi
}

/** True when the API accepted the session but the role is not allowed. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
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

/**
 * A string body is only worth showing if it is a short, plain-text message the
 * API meant for a human. Infrastructure error pages (a Vercel 404, an nginx
 * 502, an HTML error document) also arrive as strings, and dumping those into
 * the UI shows the user a wall of markup instead of a usable error.
 */
function usableTextBody(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 200) return false
  if (trimmed.startsWith('<')) return false
  return !/^the page could not be found/i.test(trimmed)
}

/**
 * The API's 400 and 409 messages are written for this audience and say what to
 * do next, so they are surfaced verbatim rather than replaced with our own.
 */
function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'string') return usableTextBody(body) ? body.trim() : fallback
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

  const url = `${API_BASE}${path}`

  const res = await fetch(url, {
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
    throw new ApiError(
      res.status,
      messageFrom(payload, `Request failed (${res.status})`),
      payload,
      url,
      looksLikeApiError(payload),
    )
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
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

import type {
  Admin,
  ApiUser,
  BillingOverview,
  BillingPlan,
  BillingSaveResult,
  CommunityMember,
  CreateAdminInput,
  CreateCommunityInput,
  CreateCreditPackInput,
  CreateUserInput,
  CreditPack,
  FeedbackPage,
  FeedbackQuery,
  FeedbackRow,
  FeedbackStatus,
  HealthResponse,
  Language,
  LogPage,
  LogQuery,
  LogRow,
  LogStats,
  Role,
  PriceToken,
  StatsBucket,
  UpdateAdminInput,
  UpdateCommunityInput,
  UpdateCreditPackInput,
  UpdateFeedbackInput,
  UpdatePlanInput,
  UpdateUserInput,
  UsersCountResponse,
} from './types'
import { FEEDBACK_STATUSES, UNTRIAGED } from './types'

/**
 * Several list endpoints return either a bare array or an envelope such as
 * `{ rows: [...] }`. Rather than guess, pull the first array we find.
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

/**
 * Billing writes answer `{ plan | pack, warning }`. Tolerate a bare row too, so
 * an older API build still reads.
 */
export function toSaveResult<T>(payload: unknown, key: 'plan' | 'pack'): BillingSaveResult<T> {
  if (!payload || typeof payload !== 'object') return { row: null, warning: null }
  const record = payload as Record<string, unknown>
  const warning = typeof record.warning === 'string' && record.warning ? record.warning : null
  const row = (key in record ? record[key] : payload) as T
  return { row, warning }
}

/** Drops undefined, empty-string and null params so they never hit the wire. */
function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

function numberFrom(record: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return fallback
}

/** Normalises whatever envelope the log list arrives in into a LogPage. */
export function toLogPage(payload: unknown, fallbackLimit: number): LogPage {
  const rows = unwrapList<LogRow>(payload)
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}

  return {
    rows,
    total: numberFrom(record, ['total', 'count', 'totalCount'], rows.length),
    page: numberFrom(record, ['page', 'currentPage'], 1),
    limit: numberFrom(record, ['limit', 'pageSize', 'perPage'], fallbackLimit),
  }
}

/**
 * Normalises whatever envelope GET /v1/feedback arrives in into a FeedbackPage.
 *
 * Its 200 is documented only as `description: ''`, so the shape is read
 * defensively exactly as the log list is. `counts` is picked up if the API
 * offers per-status totals and left null if it does not — the inbox then
 * derives the untriaged count from a dedicated query rather than guessing from
 * one page of rows, which would undercount the moment there were more than a
 * page of them.
 */
export function toFeedbackPage(payload: unknown, fallbackLimit: number): FeedbackPage {
  const rows = unwrapList<FeedbackRow>(payload)
  const record =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}

  let counts: FeedbackPage['counts'] = null
  const raw = record.counts ?? record.byStatus ?? record.statusCounts
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const source = raw as Record<string, unknown>
    const parsed: Partial<Record<FeedbackStatus, number>> = {}
    for (const status of FEEDBACK_STATUSES) {
      const value = source[status]
      if (typeof value === 'number' && Number.isFinite(value)) parsed[status] = value
    }
    if (Object.keys(parsed).length) counts = parsed
  }

  return {
    rows,
    total: numberFrom(record, ['total', 'count', 'totalCount'], rows.length),
    page: numberFrom(record, ['page', 'currentPage'], 1),
    limit: numberFrom(record, ['limit', 'pageSize', 'perPage'], fallbackLimit),
    counts,
  }
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export const endpoints = {
  /* ----------------------------- auth ----------------------------------- */
  login: (email: string, password: string) =>
    apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    }),
  logout: () => apiRequest<unknown>('/auth/logout', { method: 'POST' }),
  me: (signal?: AbortSignal) => api.get<Record<string, unknown>>('/auth/me', signal),

  /* ----------------------------- users ---------------------------------- */
  usersCount: (signal?: AbortSignal) => api.get<UsersCountResponse>('/users/all-users', signal),
  /** Unpaginated — returns every user. Filter and page client-side. */
  users: async (signal?: AbortSignal) =>
    unwrapList<ApiUser>(await api.get<unknown>('/users/all-users-data', signal)),
  user: (id: number | string, signal?: AbortSignal) => api.get<ApiUser>(`/users/${id}`, signal),
  createUser: (input: CreateUserInput) => api.post<unknown>('/users/create-user', input),
  updateUser: (id: number | string, input: UpdateUserInput) =>
    api.patch<unknown>(`/users/${id}`, input),
  deleteUser: (id: number | string) => api.delete<unknown>(`/users/${id}`),
  /** SUPERADMIN only. */
  changeUserRole: (id: number | string, role: Role) =>
    api.patch<unknown>(`/users/${id}/role`, { role }),

  /* ------------------- admin accounts (SUPERADMIN only) ------------------ */
  admins: async (signal?: AbortSignal) =>
    unwrapList<Admin>(await api.get<unknown>('/admin', signal)),
  /**
   * GET /v1/admin/{id}.
   *
   * Only ever called with a numeric id. A non-numeric one would be routed to
   * this handler on an API build whose sub-controllers register after it, which
   * is the collision isMissingRoute documents — so don't hand it a slug.
   */
  admin: (id: number, signal?: AbortSignal) => api.get<Admin>(`/admin/${id}`, signal),
  createAdmin: (input: CreateAdminInput) => api.post<Admin>('/admin', input),
  updateAdmin: (id: number, input: UpdateAdminInput) => api.patch<Admin>(`/admin/${id}`, input),
  deleteAdmin: (id: number) => api.delete<{ message: string }>(`/admin/${id}`),

  /* ---------------------------- community -------------------------------- */
  community: async (signal?: AbortSignal) =>
    unwrapList<CommunityMember>(await api.get<unknown>('/community', signal)),
  communityMember: (id: number | string, signal?: AbortSignal) =>
    api.get<CommunityMember>(`/community/${id}`, signal),
  /** The public join endpoint — the panel uses it to add an entry by hand. */
  createCommunityMember: (input: CreateCommunityInput) =>
    api.post<CommunityMember>('/community', input),
  updateCommunityMember: (id: number | string, input: UpdateCommunityInput) =>
    api.patch<unknown>(`/community/${id}`, input),
  /** SUPERADMIN only. */
  deleteCommunityMember: (id: number | string) => api.delete<unknown>(`/community/${id}`),

  /* ----------------------------- feedback -------------------------------- */
  /**
   * The panel inbox. ADMIN and SUPERADMIN; the server's own default limit is
   * 25 and it caps at 200.
   */
  feedback: async (query: FeedbackQuery = {}, signal?: AbortSignal): Promise<FeedbackPage> => {
    const limit = query.limit ?? 25
    const payload = await api.get<unknown>(`/feedback${queryString({ ...query, limit })}`, signal)
    return toFeedbackPage(payload, limit)
  },
  feedbackMessage: (id: number, signal?: AbortSignal) =>
    api.get<FeedbackRow>(`/feedback/${id}`, signal),
  /**
   * How many messages nobody has looked at yet.
   *
   * Asks for a single row and reads the envelope's `total`, so the number is
   * the server's own count rather than something counted off a page — a page of
   * rows would silently cap the badge at its own length.
   */
  untriagedFeedbackCount: async (signal?: AbortSignal): Promise<number> => {
    const page = await endpoints.feedback({ status: UNTRIAGED, limit: 1, page: 1 }, signal)
    return page.total
  },
  /** Triage: set a status, leave a private staff note, or both. */
  updateFeedback: (id: number, input: UpdateFeedbackInput) =>
    api.patch<FeedbackRow>(`/feedback/${id}`, input),
  /** SUPERADMIN only. Prefer status SPAM — a delete cannot be undone. */
  deleteFeedback: (id: number) => api.delete<unknown>(`/feedback/${id}`),

  /* --------------------------- price tokens ------------------------------- */
  /**
   * Wired for completeness. The deployed controller is still a scaffold — the
   * list returns the literal string "This action returns all priceToken" — so
   * the panel ships no screen for it. See the PriceToken type.
   */
  priceTokens: async (signal?: AbortSignal) =>
    unwrapList<PriceToken>(await api.get<unknown>('/price-token', signal)),

  /* ----------------------------- billing --------------------------------- */
  billingOverview: (signal?: AbortSignal) =>
    api.get<BillingOverview>('/admin/billing/overview', signal),
  billingPlans: async (signal?: AbortSignal) =>
    unwrapList<BillingPlan>(await api.get<unknown>('/admin/billing/plans', signal)),
  updatePlan: async (id: string, input: UpdatePlanInput) =>
    toSaveResult<BillingPlan>(await api.patch<unknown>(`/admin/billing/plans/${id}`, input), 'plan'),
  creditPacks: async (signal?: AbortSignal) =>
    unwrapList<CreditPack>(await api.get<unknown>('/admin/billing/credit-packs', signal)),
  createCreditPack: async (input: CreateCreditPackInput) =>
    toSaveResult<CreditPack>(await api.post<unknown>('/admin/billing/credit-packs', input), 'pack'),
  updateCreditPack: async (id: string, input: UpdateCreditPackInput) =>
    toSaveResult<CreditPack>(
      await api.patch<unknown>(`/admin/billing/credit-packs/${id}`, input),
      'pack',
    ),
  /** SUPERADMIN only. Prefer active:false. */
  deleteCreditPack: (id: string) => api.delete<unknown>(`/admin/billing/credit-packs/${id}`),

  /* --------------------------- activity log ------------------------------ */
  logs: async (query: LogQuery = {}, signal?: AbortSignal): Promise<LogPage> => {
    const limit = query.limit ?? 50
    const payload = await api.get<unknown>(`/admin/logs${queryString({ ...query, limit })}`, signal)
    return toLogPage(payload, limit)
  },
  log: (id: string, signal?: AbortSignal) => api.get<LogRow>(`/admin/logs/${id}`, signal),
  logActions: async (signal?: AbortSignal) =>
    unwrapList<string>(await api.get<unknown>('/admin/logs/actions', signal)),
  logStats: (
    params: { bucket?: StatsBucket; from?: string; to?: string; action?: string; actorId?: number },
    signal?: AbortSignal,
  ) => api.get<LogStats>(`/admin/logs/stats${queryString(params)}`, signal),

  /* ------------------------- read-only extras ---------------------------- */
  health: (signal?: AbortSignal) => api.get<HealthResponse>('/health', signal),
  languages: async (signal?: AbortSignal) =>
    unwrapList<Language>(await api.get<unknown>('/languages', signal)),
  language: (code: string, signal?: AbortSignal) =>
    api.get<Language>(`/languages/${encodeURIComponent(code)}`, signal),

  /**
   * The PUBLIC catalogue — what a customer actually sees, as opposed to
   * /admin/billing/plans which lists every plan whether sellable or not.
   * Reading both is the only way to tell "we configured it" from "it is on
   * sale", so the billing screen compares them.
   */
  publicPlans: (signal?: AbortSignal) => api.get<unknown>('/payments/plans', signal),
  publicCreditPacks: (signal?: AbortSignal) => api.get<unknown>('/payments/credit-packs', signal),
}

/* -------------------------------------------------------------------------- */
/* Log stream (SSE over fetch)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe to GET /admin/logs/stream.
 *
 * `EventSource` cannot set an Authorization header — the browser API takes a
 * URL and nothing else — and the token must not go in the query string, so
 * this reads the stream with fetch and parses the SSE framing by hand.
 *
 * Returns an unsubscribe function. `onError` fires when the stream cannot be
 * established (including a 404 from an API build that predates it), which is
 * the caller's cue to fall back to polling.
 */
export function streamLogs(
  onRow: (row: LogRow) => void,
  onError: (error: Error) => void,
): () => void {
  const controller = new AbortController()

  ;(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/logs/stream`, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          Accept: 'text/event-stream',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })

      if (!res.ok || !res.body) {
        throw new ApiError(res.status, `Log stream unavailable (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line. Keep the trailing partial
        // frame in the buffer until its terminator arrives.
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n')

          if (!data) continue
          try {
            onRow(JSON.parse(data) as LogRow)
          } catch {
            // A heartbeat or comment frame — nothing to render.
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return () => controller.abort()
}
