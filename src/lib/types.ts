/**
 * Types mirroring the TH-LABS API (https://th-labs.uz/docs-json).
 *
 * The spec documents request bodies precisely but leaves most response bodies
 * as untyped `200 description: ''`. Where that is the case the types below are
 * inferred from the DTOs the endpoints are built on and are marked as such —
 * the UI is written to tolerate extra or missing fields rather than assume.
 */

export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN'

export const ROLES: Role[] = ['USER', 'ADMIN', 'SUPERADMIN']

/** Roles permitted to sign in to this panel. */
export const STAFF_ROLES: Role[] = ['ADMIN', 'SUPERADMIN']

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

/**
 * A user row from GET /v1/users/all-users-data.
 *
 * The spec does not describe this response, so only the AuthUserDto fields are
 * guaranteed. Anything else the API returns is preserved and surfaced
 * generically on the user detail page.
 */
export interface ApiUser {
  id: number
  email: string
  name: string
  role: Role
  createdAt: string
  updatedAt?: string
  [key: string]: unknown
}

export interface Admin {
  id: number
  email: string
  name: string
  role: Role
  createdAt: string
  [key: string]: unknown
}

/** GET /v1/wait-list — response shape is undocumented; fields are best-effort. */
export interface WaitListEntry {
  id: number | string
  userName?: string
  email?: string
  createdAt?: string
  [key: string]: unknown
}

export interface Plan {
  id: string
  tier: 'FREE' | 'PRO' | 'STUDIO' | string
  cycle: 'WEEKLY' | 'MONTHLY' | 'YEARLY' | string
  priceCents: number
  creditsGranted: number
  grantDays: number
  grantsPerPeriod: number
  stripePriceId: string | null
  stripeLinkUrl: string | null
  active: boolean
}

export interface PlansResponse {
  plans: Plan[]
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

/** Credit ledger / payment history rows are undocumented — rendered generically. */
export interface LedgerRow {
  id?: string | number
  createdAt?: string
  amount?: number
  [key: string]: unknown
}

export interface Paginated<T> {
  items?: T[]
  data?: T[]
  total?: number
  page?: number
  limit?: number
  [key: string]: unknown
}
