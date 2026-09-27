/**
 * Types mirroring the TH-LABS account API (NestJS, every path under /v1).
 *
 * These follow the verified contract in the build brief rather than the
 * published Swagger, which leaves most response bodies as untyped
 * `200 description: ''`. Where a shape is documented it is typed exactly;
 * where it is an envelope the API has never pinned down (list wrappers,
 * ledger rows) the UI reads defensively instead of assuming.
 */

export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN'

export const ROLES: Role[] = ['USER', 'ADMIN', 'SUPERADMIN']

/**
 * Roles permitted to sign in to this panel.
 *
 * The API's guard treats SUPERADMIN as satisfying every role, so staff checks
 * must always be "ADMIN or SUPERADMIN" — never `role === 'ADMIN'`.
 */
export const STAFF_ROLES: Role[] = ['ADMIN', 'SUPERADMIN']

export function isStaffRole(role: unknown): role is Role {
  return role === 'ADMIN' || role === 'SUPERADMIN'
}

export interface AuthUser {
  id: number
  email: string
  name: string
  role: Role
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  user: AuthUser
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A row from GET /v1/users/all-users-data.
 *
 * There is no pagination or search on that endpoint — it returns every user in
 * one payload, so the Users screen filters and pages client-side.
 */
export interface ApiUser {
  id: number
  email: string
  name: string
  role: Role
  credits?: number
  freeDubUsed?: boolean
  dodoCustomerId?: string | null
  createdAt: string
  updatedAt?: string
  [key: string]: unknown
}

export interface UsersCountResponse {
  usersCount: number
}

export interface CreateUserInput {
  name: string
  email: string
  password: string
}

export interface UpdateUserInput {
  name?: string
  email?: string
  password?: string
}

/* -------------------------------------------------------------------------- */
/* Admin accounts — the `Admin` table, NOT the accounts that sign in here      */
/* -------------------------------------------------------------------------- */

export interface Admin {
  id: number
  email: string
  name: string
  role: Role
  createdAt: string
  [key: string]: unknown
}

export interface CreateAdminInput {
  name: string
  email: string
  password: string
  role?: Role
}

export interface UpdateAdminInput {
  name?: string
  email?: string
  password?: string
  role?: Role
}

/* -------------------------------------------------------------------------- */
/* Community — landing-page signups                                            */
/* -------------------------------------------------------------------------- */

export interface CommunityMember {
  id: number | string
  userName?: string
  email?: string
  createdAt?: string
  [key: string]: unknown
}

/** POST /v1/community — both fields required. The join endpoint is public. */
export interface CreateCommunityInput {
  userName: string
  email: string
}

export interface UpdateCommunityInput {
  userName?: string
  email?: string
}

/* -------------------------------------------------------------------------- */
/* Billing — GET /v1/admin/billing/*                                           */
/* -------------------------------------------------------------------------- */

export interface BillingOverview {
  provider: string
  mode: 'test' | 'live' | string
  /** False → static payment links only; cancel and the customer portal are off. */
  apiConfigured: boolean
  /** False → a payment can never grant credits. The loudest failure there is. */
  webhookConfigured: boolean
  plans: { total: number; sellable: number; unconfigured: string[] }
  creditPacks: { total: number; active: number; unconfigured: string[] }
  links: { live: number; test: number; mixed: boolean }
  qualityCost: Record<string, number>
  tariff: { creditsPerMinute: number; qualityMultiplier: Record<string, number> }
  [key: string]: unknown
}

export interface BillingPlan {
  id: string
  tier: string
  cycle: string
  priceCents: number
  creditsGranted: number
  grantDays: number
  grantsPerPeriod: number
  dodoProductId: string | null
  dodoLinkUrl: string | null
  active: boolean
  /** False → the plan cannot be bought, whatever `active` says. */
  configured: boolean
  /** False for the FREE tier — nothing to sell. */
  sellable: boolean
  /** creditsGranted × grantsPerPeriod. */
  creditsPerPeriod: number
  linkIsTestMode: boolean
  [key: string]: unknown
}

/**
 * PATCH /v1/admin/billing/plans/:id — every field optional, send only what
 * changed. `dodoProduct` takes either a bare product id or a full payment
 * link; the server derives the other half. "" clears it, taking the plan off
 * sale without deactivating it.
 */
export interface UpdatePlanInput {
  dodoProduct?: string
  priceCents?: number
  creditsGranted?: number
  grantDays?: number
  grantsPerPeriod?: number
  active?: boolean
}

export interface CreditPack {
  id: string
  /** Permanent. It travels in checkout metadata and the webhook reads it back. */
  slug: string
  credits: number
  priceCents: number
  currency: string
  popular: boolean
  sortOrder: number
  dodoProductId: string | null
  dodoLinkUrl: string | null
  active: boolean
  configured: boolean
  linkIsTestMode: boolean
  [key: string]: unknown
}

export const SLUG_PATTERN = /^[a-z0-9_-]{3,60}$/

export interface CreateCreditPackInput {
  slug: string
  credits: number
  priceCents: number
  currency?: string
  popular?: boolean
  sortOrder?: number
  dodoProduct?: string
  active?: boolean
}

/** Same as create minus `slug`, which cannot be changed after creation. */
export type UpdateCreditPackInput = Omit<CreateCreditPackInput, 'slug'>

/* -------------------------------------------------------------------------- */
/* Activity log — GET /v1/admin/logs                                           */
/* -------------------------------------------------------------------------- */

/** Who did what to whom. Reads of the log are not themselves logged. */
export interface LogRow {
  id: string
  createdAt: string
  actorId: number | null
  actorEmail: string | null
  actorRole: Role | null
  /** Stable, never contains an id. Filtered by prefix: `billing` ⊃ `billing.*`. */
  action: string
  method: string
  path: string
  statusCode: number
  durationMs: number
  success: boolean
  targetType: 'user' | 'admin' | 'plan' | 'creditPack' | 'language' | string | null
  targetId: string | null
  /** The human-readable target — an email, a slug, a tier. */
  targetLabel: string | null
  summary: string
  /** Secrets arrive already `[redacted]`. */
  meta?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
  [key: string]: unknown
}

export interface LogQuery {
  page?: number
  /** Server caps this at 200. */
  limit?: number
  actorId?: number | string
  actorEmail?: string
  role?: Role
  action?: string
  method?: string
  targetType?: string
  targetId?: string
  targetLabel?: string
  success?: boolean
  from?: string
  to?: string
  /** Searches summary, path, action, and both the actor and target emails. */
  q?: string
}

export interface LogPage {
  rows: LogRow[]
  total: number
  page: number
  limit: number
}

export type StatsBucket = 'second' | 'minute' | 'hour' | 'day'

export interface LogStats {
  from: string
  to: string
  bucket: StatsBucket
  total: number
  counted: number
  /** True → the window held more events than were counted. Say so honestly. */
  truncated: boolean
  failed: number
  successRate: number
  avgDurationMs: number
  series: Array<{ at: string; total: number; failed: number }>
  topActions: Array<Record<string, unknown>>
  topActors: Array<Record<string, unknown>>
  [key: string]: unknown
}

/* -------------------------------------------------------------------------- */
/* Health & languages — read-only                                              */
/* -------------------------------------------------------------------------- */

export interface HealthResponse {
  app: string
  version: string
  mode: string
  ffmpeg: boolean
  stages: Array<Record<string, unknown>>
  database: string
  pipeline: string
  [key: string]: unknown
}

export interface Language {
  code: string
  name: string
  native: string
  flag: string
  whisper: string
  nllb: string
  [key: string]: unknown
}

/* -------------------------------------------------------------------------- */
/* Feedback — GET/PATCH/DELETE /v1/feedback                                    */
/* -------------------------------------------------------------------------- */

/**
 * Triage state. `NEW` is the only one that means "nobody has looked at this",
 * so it is what the sidebar badge counts — see UNTRIAGED below.
 */
export type FeedbackStatus = 'NEW' | 'READ' | 'IN_PROGRESS' | 'RESOLVED' | 'SPAM'

export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  'NEW',
  'READ',
  'IN_PROGRESS',
  'RESOLVED',
  'SPAM',
]

/** What the sender said the message is about. */
export type FeedbackKind = 'GENERAL' | 'BUG' | 'FEATURE' | 'PRICING' | 'QUALITY'

export const FEEDBACK_KINDS: FeedbackKind[] = ['GENERAL', 'BUG', 'FEATURE', 'PRICING', 'QUALITY']

/**
 * The status that still needs a human.
 *
 * Anything else has been seen by someone — even SPAM is a decision. So this is
 * the count the nav badge shows, and it is the one number that has to be right:
 * an inbox that under-reports is worse than no inbox at all.
 */
export const UNTRIAGED: FeedbackStatus = 'NEW'

export const STATUS_TONE: Record<FeedbackStatus, string> = {
  NEW: 'blue',
  READ: '',
  IN_PROGRESS: 'amber',
  RESOLVED: 'green',
  SPAM: 'red',
}

export const KIND_TONE: Record<FeedbackKind, string> = {
  GENERAL: '',
  BUG: 'red',
  FEATURE: 'violet',
  PRICING: 'amber',
  QUALITY: 'blue',
}

/**
 * One row from GET /v1/feedback.
 *
 * `name` and `email` are whatever the sender supplied, except for a signed-in
 * sender where the server overrides both from the bearer token — so they are
 * trustworthy for an account holder and self-reported for an anonymous one.
 * `userId` is what tells the two apart.
 */
export interface FeedbackRow {
  id: number
  name: string | null
  email: string | null
  subject: string | null
  message: string
  kind: FeedbackKind | string
  status: FeedbackStatus | string
  /** 1–5, optional — never demanded, so most rows have none. */
  rating: number | null
  /** Which page it was sent from. Diagnostics, not analytics. */
  pagePath: string | null
  /** Set only when the sender was signed in. null → anonymous. */
  userId: number | null
  /** Private staff note. Never shown to the sender. */
  adminNote: string | null
  userAgent: string | null
  createdAt: string
  updatedAt?: string
  [key: string]: unknown
}

export interface FeedbackQuery {
  page?: number
  /** Server caps this at 200; its own default is 25. */
  limit?: number
  status?: FeedbackStatus
  kind?: FeedbackKind
  /** Free text over subject, message, name and email. */
  q?: string
}

export interface FeedbackPage {
  rows: FeedbackRow[]
  total: number
  page: number
  limit: number
  /** Per-status totals when the API reports them — see toFeedbackPage. */
  counts: Partial<Record<FeedbackStatus, number>> | null
}

/** PATCH /v1/feedback/:id — both fields optional, send only what changed. */
export interface UpdateFeedbackInput {
  status?: FeedbackStatus
  adminNote?: string
}

/* -------------------------------------------------------------------------- */
/* Price tokens — /v1/price-token                                              */
/* -------------------------------------------------------------------------- */

/**
 * The price-token controller is still a NestJS scaffold on the deployed API:
 * `GET /v1/price-token` answers with the string "This action returns all
 * priceToken" and both DTOs are declared with no properties at all. Typed as
 * unknown-shaped on purpose — there is no contract to mirror yet, and the
 * panel deliberately ships no screen for it rather than a form that posts an
 * empty body.
 */
export interface PriceToken {
  id?: number | string
  [key: string]: unknown
}
