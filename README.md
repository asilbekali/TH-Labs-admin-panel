# TH-Labs Studio — Admin Panel

An admin console for the [TH-LABS account API](https://th-labs.uz/docs). Manage
plans and credit packs and the Lemon Squeezy wiring behind them, users and their
roles, community signups, and the activity log of who did what.

**The panel never writes to the backend's shape.** It calls only documented
`/v1` endpoints, holds no secret beyond the API base URL, and every number on
screen comes from the API — no plan price, credit count or tariff is hardcoded.

Built with React 19 + TypeScript + Vite. React Router is the only runtime
dependency beyond React itself.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

### Point it at the right API first

By default the dev proxy forwards `/api` to **`https://th-labs.uz`**, whose API
is served **only under `/v1`**. Everything else on that host is the marketing
app, which answers any unknown path with an **HTML 404 page**. That matters more
than it sounds: see "A 404 is not one thing" below.

To work against the local account API (`cd api && yarn start:dev`, port 3001),
create `.env.local`:

```bash
echo 'VITE_API_ORIGIN=http://localhost:3001' > .env.local
```

`.env.local` is gitignored. Restart `npm run dev` after changing it — Vite reads
env at startup.

Sign in with an **ADMIN** or **SUPERADMIN** account. A `USER` account is
rejected at the login screen — it would only collect `403`s once inside.

```bash
npm run build    # typecheck + production bundle into dist/
npm run lint     # oxlint
npm test         # vitest — boot sequence, login gate, and screen rendering
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

Check the first rewrite is actually live after a deploy. `curl -i
https://<panel-host>/api/health` must return the API's JSON; if it returns HTML,
the rewrite is not in effect and every screen will report
"The panel is not talking to the API".

Leave `VITE_API_BASE_URL` **unset** in the Vercel project. Setting it to
`https://th-labs.uz/v1` makes the browser call the API directly, and the API
only sends CORS headers for `th-labs.uz`, so the calls are blocked. Routing
through the rewrite keeps them same-origin.

### A 404 is not one thing

Two completely different faults both surface as a `404`, and the panel must not
confuse them — it used to, and the wrong one sends you off to redeploy a backend
that was answering perfectly well.

| What you see | What it means | The fix |
| --- | --- | --- |
| A **JSON** `404` (`{"statusCode":404,...}`) | The route genuinely is not in this API build | Redeploy the API |
| An **HTML** `404` page | The request never reached the API at all | Deploy config — the `/api` rewrite, or `VITE_API_BASE_URL` |

`isMissingRoute()` in `src/lib/api.ts` is true only for the first;
`isWrongApiBase()` is the second, and `ApiError` carries `url` and `fromApi` so
the note can name the URL it actually called. Two tests in
`src/pages/screens.test.tsx` pin both directions.

The quickest way to tell by hand:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://th-labs.uz/v1/admin/logs/actions   # 401 application/json  — route exists
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://th-labs.uz/api/admin/logs/actions  # 404 text/html         — wrong base
```

A `401` there is good news: guards only run once a route has matched, so an
unauthenticated `401` proves the route is deployed.

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

## Pages

| Page | Endpoints | Notes |
| --- | --- | --- |
| Dashboard | `admin/billing/overview`, `admin/logs*`, `/v1/feedback`, users, community | Billing health first, then a 24h chart, latest feedback and recent activity |
| Billing | `/v1/admin/billing/*` | Status panel, plans (inline edit), credit pack CRUD |
| Activity log | `/v1/admin/logs*` | Feed, filters, row detail, live updates |
| Users | `/v1/users/*` | Search, filter, sort, edit, delete; role change (SUPERADMIN) |
| User detail | `GET /v1/users/{id}` | Full record, rendered generically |
| Feedback | `/v1/feedback*` | Inbox with status/kind/search filters, triage, staff notes; delete (SUPERADMIN) |
| Community | `/v1/community` | List, search, edit, CSV export; delete (SUPERADMIN) |
| Admin records | `/v1/admin` CRUD | SUPERADMIN only — a separate table, see below |

Filtering, sorting and pagination on **Users** and **Community** are
client-side: those endpoints return their full collections in one unpaginated
payload, with no search parameter. The **Activity log** and **Feedback** page on
the server — both take `page`/`limit` and cap `limit` at 200.

`/v1/price-token` is deliberately **not** on that list. The controller is still
a NestJS scaffold on the deployed API — the list route answers with the literal
string `"This action returns all priceToken"` and both DTOs declare no
properties — so there is no contract to build against yet. `endpoints.priceTokens`
exists in the client; a screen would only be a form that posts an empty body.

### Role gating

The API's guard treats `SUPERADMIN` as satisfying every role, so the panel never
checks `role === 'ADMIN'` — staff is always "ADMIN or SUPERADMIN"
(`isStaffRole()` in `src/lib/types.ts`). These are SUPERADMIN-only and are
hidden from an ADMIN, *and* still handled if the server refuses — the server is
the authority:

- changing a user's role
- creating, editing or deleting admin records
- deleting a credit pack
- deleting a community entry

### `/v1/admin` is not who can sign in

The `Admin` table is **separate from `User`**. Panel sign-in and every role
check run off `User.role`; a row in `Admin` grants nobody access and deleting
one locks nobody out. The page says so in a banner, because the endpoint name
invites exactly the opposite assumption.

## What the API does and does not offer

**Feedback has to be noticed, not checked.** Anyone can `POST /v1/feedback`;
reading and triaging is ADMIN or SUPERADMIN, and deleting is SUPERADMIN only.
A message in `NEW` is one nobody has looked at, so that count — and only that
count — is what the sidebar badge shows. Three rules make it trustworthy:

- It comes from the server's own `total` for `status=NEW&limit=1`, never from
  counting rows on a page. Counting rows would silently cap the badge at the
  page size and under-report exactly when the inbox is busiest.
- Opening a message changes nothing. Triage is a person picking a status, so the
  count cannot drift to meaning "nobody has clicked it".
- One shared count (`FeedbackInboxProvider` in `src/lib/feedbackInbox.tsx`)
  feeds the badge, the dashboard tile and the inbox, and a triage refreshes it
  immediately. A badge that disagrees with the inbox it links to is worse than
  no badge.

It polls every 60s and re-reads on tab focus. On a 403 or 404 the count stays
**unknown** and nothing renders — never a confident `0`.

The server overwrites `name` and `email` from the bearer token for a signed-in
sender, so those are verified only when `userId` is set. The panel says which,
rather than presenting a self-reported address as if the API vouched for it.

**The activity log is real and append-only.** `/v1/admin/logs` records who did
what to whom. Nothing can edit or delete a row, and reading the log is not
itself logged — the UI does not imply otherwise.

`action` filters by **prefix**, so `action=billing` matches every `billing.*`.
The `q` box searches the summary, path, action and *both* the actor and target
emails, so one search answers "everything about this person" in both
directions.

`stats` returns `truncated`. When it is true the panel says "showing the first
N events" rather than letting the chart imply it covers the whole window.

**Live updates use fetch, not `EventSource`.** `EventSource` cannot set an
`Authorization` header, and the token must not go in the query string, so
`streamLogs()` in `src/lib/api.ts` reads `/admin/logs/stream` with `fetch` and
parses the SSE framing itself. If the stream cannot be established — including
on an API build that has no such route — it falls back to polling every 5s and
the badge next to the "Live" toggle says which is in use.

**Billing endpoints for a single user are self-scoped.** `/v1/payments/
subscription`, `/credits` and `/history` read the *authenticated caller's*
record. There is no admin route to read another user's ledger, so per-user
billing cannot appear on the user detail page.

**Read-only, deliberately not built:** `/v1/languages` has no write endpoints,
and `/v1/price-token` is an unimplemented scaffold that returns placeholder
strings — credit pricing lives in `/admin/billing/credit-packs`. Neither has an
editor here.

**Plan cycles come from the API, never from the panel.** The plans table renders
whatever `plan.cycle` says. Nothing here hardcodes a set of cycles, and the plan
editor cannot change one — `UpdatePlanDto` has no `cycle` field, so a cycle only
ever exists because a row in the plans table says so.

> **Known mismatch: weekly is not a product we sell.**
> As of 2026-09-27 the plans table still holds two **active** weekly rows, and
> `GET /v1/payments/plans` is the *public* catalogue of active plans — so they
> are advertised to anyone who calls it:
>
> | Plan | Price | Id |
> | --- | --- | --- |
> | `PRO/WEEKLY` | $6.00 | `cmsexr7s30001lz3cj6mmqxg8` |
> | `STUDIO/WEEKLY` | $15.00 | `cmsexr7s80004lz3ccnnpn0o5` |
>
> This is data, not code: retire them with `active: false` (Billing → edit the
> plan → untick Active → Save). Prefer that to a delete — it takes them off the
> public catalogue while leaving any existing subscription's history intact.
> Re-run the check below afterwards; weekly should be gone from the output.

```bash
curl -s https://th-labs.uz/v1/payments/plans \
  | python3 -c 'import json,sys; [print(p["tier"], p["cycle"], p["priceCents"]) for p in json.load(sys.stdin)["plans"]]'
```

`POST /v1/users/create-user` is the public registration route, so new users are
always created with the `USER` role. Promote them from the Users page.

## The server has caught up

`https://th-labs.uz/v1` now serves the full contract this panel is written
against — 65 paths, including `admin-logs`, `admin-billing` and `feedback`.
Verified 2026-09-27 against <https://th-labs.uz/docs-json>.

There is nothing to switch and no code change to make. An unauthenticated probe
is the quickest confirmation, because guards only run once a route has matched:

```bash
curl -s https://th-labs.uz/v1/admin/logs/actions   # {"message":"Unauthorized","statusCode":401}
curl -s https://th-labs.uz/v1/feedback             # {"message":"Unauthorized","statusCode":401}
```

A `401` there means the route is deployed. A **JSON** `404` would mean it is not.
An **HTML** `404` means the request never reached the API — see "A 404 is not one
thing".

So if a screen still reports "this API build has no … endpoints" against
`th-labs.uz`, the base URL is the thing to check first, not the backend.

The one thing worth checking on the billing status panel: when
`canGrantCredits` is **false** the API has no `LEMONSQUEEZY_API_KEY`, so no
order can be verified and no purchase can grant credits. The panel shows that in
red at the top of Billing and the Dashboard. Lemon Squeezy needs no webhook —
the API polls for orders — but each LS product should redirect to the
`successUrl` shown on the Billing screen so buyers are credited in seconds.

Putting a plan or credit pack on sale takes **both** its Lemon Squeezy share
link (`checkoutUrl`) and its variant id (`lsVariantId`). Either alone saves, but
the item stays off sale and the API returns a `warning` the panel shows.

Detection note: the panel probes for a missing feature with a **two-segment**
route (`/admin/logs/actions`, `/admin/logs/stats`), never the bare
`/admin/logs`. On a build whose sub-controllers register after `AdminController`,
`/admin/logs` collides with `GET /admin/{id}` and answers `401` unauthenticated
or **`500`** signed in — neither is a `404`, so only a sibling route can tell you
the feature is absent.

## Defensive rendering

Most response bodies are undocumented in the OpenAPI spec (`200 description: ''`).
Where the shape isn't guaranteed, the UI renders whatever comes back instead of
assuming a fixed set of columns:

- `unwrapList()` accepts either a bare array or an envelope like `{ rows: [...] }`.
- The user detail page renders every returned field generically, so extra fields
  show up rather than being silently dropped. Credential-looking keys
  (`password`, `passwordHash`, `salt`, `refreshToken`) are filtered out.

If the API later returns richer user records, they surface automatically.

## Project layout

```
src/
  lib/       api client (+ SSE reader), types, data hooks, formatters,
             feedbackInbox (shared untriaged count)
  auth/      AuthContext — session, boot refresh, role gating
  components/ Layout, Modal, Toast, shared UI primitives, icons
  pages/     Login, Dashboard, Billing, Activity, Feedback, Users, UserDetail,
             Community, Admins
  index.css  design tokens + all component styles (dark/light)
```
