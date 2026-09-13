# TH-Labs Studio — Admin Panel

An admin console for the [TH-LABS API](https://th-labs.uz/docs). Manage user
accounts and their data, staff accounts, the early-access wait list, the plan
catalogue, and review platform activity.

Built with React 19 + TypeScript + Vite. React Router is the only runtime
dependency beyond React itself.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

Sign in with an **ADMIN** or **SUPERADMIN** account. A `USER` account is
rejected at the login screen — it would only collect `403`s once inside.

```bash
npm run build    # typecheck + production bundle into dist/
npm run lint     # oxlint
npm test         # vitest — boot-sequence regression tests
```

## Deploying to Vercel

`vercel.json` carries the two rewrites the app cannot work without:

```json
{ "source": "/api/:path*", "destination": "https://th-labs.uz/v1/:path*" }
{ "source": "/(.*)",       "destination": "/index.html" }
```

The first replaces the Vite dev proxy. Without it `/api/auth/login` hits
Vercel's static host and comes back `404 NOT_FOUND`, so **every sign-in fails**.
The second is the SPA fallback — without it `/login` and every other deep link
404s on reload.

Leave `VITE_API_BASE_URL` **unset** in the Vercel project. Setting it to
`https://th-labs.uz/v1` makes the browser call the API directly, and the API
only sends CORS headers for `th-labs.uz`, so the calls are blocked. Routing
through the rewrite keeps them same-origin.

### Web Analytics

`<Analytics />` is mounted in `src/App.tsx` — above the router, so the login
screen is measured too, and from `@vercel/analytics/react` (the `/next` entry
point does not work in a Vite SPA).

It reports through `beforeSend` in `src/lib/analytics.ts`, which rewrites
`/users/412` to `/users/[id]` and strips the query and hash. Without that, the
single most-used page in the panel is scattered across one row per customer
record, and the ids of records staff opened are sent to a third party. No route
here keeps state in the query string, so nothing is lost by dropping it.

It only injects its script in a production build; `npm run dev` and the test
suite no-op. Collection still has to be switched on under **Analytics** in the
Vercel project — the component alone does not enable it.

### The refresh cookie does not survive on `*.vercel.app`

The backend scopes its refresh cookie to `th-labs.uz`. The dev proxy rewrites
that with `cookieDomainRewrite`, but **Vercel rewrites cannot** — so the browser
drops the cookie on a `vercel.app` host. Signing in works (the access token
comes back in the body), but the session will not survive a reload, and it ends
when the access token expires.

Either fix removes it for good:

1. Serve the panel from a `th-labs.uz` subdomain, so the cookie's domain
   matches — this is the one to do.
2. Have the backend omit the `Domain` attribute on the refresh cookie, which
   pins it to whatever host served it.

## Why requests go through `/api`

The backend only returns `Access-Control-Allow-Origin` for `https://th-labs.uz`
and `https://www.th-labs.uz`. A browser on `localhost:5173` therefore cannot
call it directly — the preflight comes back without the header and the request
is blocked.

So the Vite dev server proxies `/api/*` → `https://th-labs.uz/v1/*`. The browser
sees a same-origin request; the proxy talks to the API server-to-server, where
CORS does not apply. `cookieDomainRewrite` rewrites the refresh cookie's domain
from `th-labs.uz` to the dev host, without which the session could never be
refreshed.

Override the upstream with `VITE_API_ORIGIN` (see `.env.example`) to point at a
local backend.

**Deploying:** serve the panel from an origin the API allows, and either put the
same `/api → /v1` proxy in front of it or set `VITE_API_BASE_URL`. If you choose
a new origin, it must be added to the backend's CORS allowlist first.

## Authentication

Per the API's design, the access token is short-lived and the refresh token
arrives as an `httpOnly` cookie.

- The access token is kept **in memory only**, never in `localStorage` — an XSS
  bug there would otherwise hand an attacker a bearer token.
- On boot the app calls `POST /auth/refresh`, so reloading a deep link keeps you
  signed in.
- Any `401` triggers one refresh-and-replay; if that fails the session is torn
  down and you land back on `/login`.
- Concurrent refreshes are de-duplicated, so a page firing four requests at
  mount doesn't race four token rotations against each other.

**A `401` from `/auth/refresh` in the console is normal** when you are signed
out — there is no refresh cookie to rotate, so the app falls through to the
login screen. It is not an error to chase.

The boot effect deliberately has **no "run once" ref guard**. Under StrictMode
the effect runs twice; a ref guard makes the second pass bail out while the
first has already been cancelled by its own cleanup, so `ready` never flips and
the app hangs on "Restoring session…" forever. `refreshSession()` de-duplicates
in-flight calls, which makes the guard unnecessary anyway.
`src/auth/AuthContext.test.tsx` renders the real app inside `StrictMode` and
covers this — those tests fail if the guard is reintroduced.

### Built-in default admin

If the backend has no admin to sign in with — it rejects the credentials, or it
is unreachable — signing in as **`super@gmail.com` / `iamadmin`** drops into the
panel as a local `SUPERADMIN`. It exists so the panel can be opened and
navigated before a real admin account exists.

It is a **client-side session only**: there is no access token behind it, so
every call to the real API still fails, and pages that read or write live data
come back empty. A banner at the top of every page says so. A `401` on those
calls deliberately does *not* tear the session down, since it would otherwise
bounce straight back to `/login`.

A real backend admin always wins — the fallback is only reached after
`POST /auth/login` has already failed, so nothing shadows a live account.

Anyone who can load the bundle can read these credentials. Set
`VITE_ENABLE_DEFAULT_ADMIN=false` on a deployment pointed at a real backend;
`VITE_DEFAULT_ADMIN_EMAIL` / `VITE_DEFAULT_ADMIN_PASSWORD` override the pair.
See `src/auth/fallbackAdmin.ts`.

## Pages

| Page | Endpoints | Notes |
| --- | --- | --- |
| Dashboard | users, wait list, plans, admins | Totals, newest users, recent activity |
| Users | `GET/PATCH/DELETE /v1/users/*` | Search, role filter, sort, pagination, create/edit/delete |
| User detail | `GET /v1/users/{id}` | Full record incl. registration dates |
| Admins | `/v1/admin` CRUD | SUPERADMIN only; self-deletion is blocked |
| Wait list | `/v1/wait-list` | List, search, delete, CSV export |
| Billing & plans | `/v1/payments/*` | Plan catalogue + your own billing state |
| Activity log | derived | See the caveat below |

Filtering, sorting and pagination are client-side: the user and wait list
endpoints return their full collections in one unpaginated payload.

## Two API gaps worth knowing about

These are limits of the backend, not of the UI. Both are surfaced in-app rather
than hidden.

**1. There is no audit-log endpoint.** Nothing in the API records who did what.
The Activity page therefore reconstructs a timeline from the `createdAt`
timestamps that *are* exposed — user registrations, admin account creations and
wait list joins. That means it shows **records being created, not actions
administrators took**: deletions, edits and logins leave no trace. When the
backend gains a real log endpoint, add it as another source in
`src/lib/activity.ts` returning `ActivityEvent[]`; the page needs no changes.

**2. Billing is self-scoped.** `/v1/payments/subscription`, `/credits` and
`/history` all read the *authenticated caller's* record. There is no admin route
to read another user's subscription or credit ledger, so per-user billing cannot
appear on the user detail page until one exists.

Two smaller notes: `UpdateWaitListDto` has no properties, so wait list entries
are effectively read-only apart from deletion; and `POST /v1/users/create-user`
is the public registration route, so new users are always created with the
`USER` role — use the Admins page to create staff.

## Defensive rendering

Most response bodies are undocumented in the OpenAPI spec (`200 description: ''`).
Where the shape isn't guaranteed, the UI renders whatever comes back instead of
assuming a fixed set of columns:

- `unwrapList()` accepts either a bare array or an envelope like `{ users: [...] }`.
- The user detail page renders every returned field generically, so extra fields
  show up rather than being silently dropped. Credential-looking keys
  (`password`, `passwordHash`, `salt`, `refreshToken`) are filtered out.
- The billing ledger tables derive their columns from the rows themselves.

If the API later returns richer user records, they surface automatically.

## Project layout

```
src/
  lib/       api client, types, data hooks, formatters, activity derivation
  auth/      AuthContext — session, boot refresh, role gating
  components/ Layout, Modal, Toast, shared UI primitives, icons
  pages/     Login, Dashboard, Users, UserDetail, Admins, WaitList, Billing, Activity
  index.css  design tokens + all component styles (dark/light)
```
