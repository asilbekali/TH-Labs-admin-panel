# Task: add live presence + "Agent City" stats to the TH-LABS API

You are working in the TH-LABS backend: NestJS + Prisma (PostgreSQL), every route
under the global `/v1` prefix, Swagger at `/docs` (JSON at `/docs-json`), bearer
JWT auth. Read the existing code before writing — match its module layout,
comment style, guards and DTO validation (class-validator + @nestjs/swagger).

## Why

The admin panel has a new full-screen page, **Agent City**, shown on the office
TV. It draws a city whose buildings are the Studio's sidebar pages (Home,
Studio, Text to speech, My works, Real-time dubbing, Tools, Docs, Developers,
Plans and billing, Settings) plus a "Website" building for th-labs.uz itself.
It needs to know:

1. who has which page open **right now**, and what they are doing;
2. today's numbers: visitors, page views, new accounts, purchases, tokens sold,
   revenue;
3. the latest signups and purchases.

The panel is already built against the exact contract below. Do not rename
fields.

## What already exists (do not rebuild)

- `JwtAuthGuard`, `OptionalJwtAuthGuard`, `RolesGuard`, `@Roles()` in
  `src/common/` — `OptionalJwtAuthGuard` lets a public route read a token when
  one is present (see `POST /v1/feedback` for the pattern).
- `AuditInterceptor` + `isAuditable()` in `src/audit/audit.action.ts` — logs
  every non-GET request to the activity log.
- Prisma models `User` (createdAt), `Payment` (status `SUCCEEDED`,
  `amountCents`, `currency`, `subscriptionId` — set → subscription, null →
  token pack), `CreditEntry` (`delta`, `reason` incl. `PACK_PURCHASE`,
  `SUBSCRIPTION_GRANT`).
- `PrismaModule` is `@Global()`.
- Migrations are applied on container start by `prisma migrate deploy`.

## 1. Prisma: `SiteVisit` model + migration

```prisma
/// One row per browser per UTC day per site, written by POST /v1/presence on
/// a page view. visitorId is a random per-browser value from localStorage.
model SiteVisit {
  id        String   @id @default(cuid())
  visitorId String
  day       String   // "YYYY-MM-DD", UTC
  site      String   // "landing" (th-labs.uz) | "app" (signed-in Studio)
  userId    Int?
  pageviews Int      @default(1)
  firstSeen DateTime @default(now())
  lastSeen  DateTime @default(now()) @updatedAt

  @@unique([visitorId, day, site])
  @@index([lastSeen])
}
```

Add a hand-written, additive-only migration folder
`prisma/migrations/<timestamp>_site_visits/migration.sql` (CREATE TABLE, the
unique index, the lastSeen index; no foreign keys), in the same style as the
existing migrations. Run `npx prisma generate`.

## 2. New `PresenceModule` (`src/presence/`)

### `POST /v1/presence` — public, `OptionalJwtAuthGuard`, `@HttpCode(204)`

Body (`HeartbeatDto`, all validated):

| field | type | rule |
|---|---|---|
| `visitorId` | string | `/^[A-Za-z0-9_-]{8,64}$/` |
| `site` | `'landing' \| 'app'` | `@IsIn` |
| `path` | string | max 200; strip `?query` and `#hash` server-side |
| `doing` | string? | max 140 — e.g. "Dubbing intro.mp4 into Uzbek" |
| `pageview` | boolean? | true on navigation, absent on keep-alive |

Behaviour:
- Keep live presence **in memory** in the service
  (`Map<visitorId, LivePresence>`), NOT in the database — tabs beat every 20s.
  Entry: `{ visitorId, site, path, doing|null, since, lastSeen, user|null }`.
  `since` resets only when `path` or `site` changes.
- Prune entries whose `lastSeen` is older than **75 s** on every write and read.
- Cap the map at **5000** entries; drop beats from new visitors beyond that.
- When `req.user` is present, look up `{ id, name, email, role }` from `User`
  **once per browser** (only when the user id changes), not on every beat.
  No token → `user: null`.
- When `pageview === true`, upsert `SiteVisit` on
  `(visitorId, today UTC, site)`: create with `pageviews: 1`, else
  `pageviews: { increment: 1 }` (and set `userId` if known).

### `GET /v1/admin/city?from=<ISO>` — `JwtAuthGuard` + `RolesGuard`, `@Roles(ADMIN, SUPERADMIN)`

`from` is the start of "today" in the **caller's** timezone (the office is in
Tashkent, UTC+5). Invalid/missing → UTC midnight.

Response — exactly this shape:

```jsonc
{
  "now": "ISO",
  "from": "ISO",
  "people": [
    {
      "visitorId": "v_…",
      "site": "app",                // or "landing"
      "path": "/studio",
      "doing": "Dubbing intro.mp4 into Uzbek",   // or null
      "since": "ISO",               // arrived on this path
      "lastSeen": "ISO",
      "user": { "id": 42, "name": "Ada Lovelace", "email": "…", "role": "USER" }  // or null
    }
  ],                                // sorted by lastSeen desc
  "today": {
    "visitors": 128,     // DISTINCT visitorId, site='landing', lastSeen >= from
    "appVisitors": 17,   // same, site='app'
    "pageviews": 412,    // SUM(pageviews) where lastSeen >= from
    "signups": 9,        // User.createdAt >= from
    "purchases": 3,      // Payment SUCCEEDED, createdAt >= from
    "subscriptions": 1,  // …of which subscriptionId != null
    "tokenPacks": 2,     // …of which subscriptionId == null
    "tokensSold": 2400,  // SUM(CreditEntry.delta) reason IN (PACK_PURCHASE, SUBSCRIPTION_GRANT), createdAt >= from
    "revenue": { "usd": 3700 }   // cents per currency — never add currencies together
  },
  "recentSignups": [ { "id": 42, "name": "…", "email": "…", "createdAt": "ISO" } ],  // newest 6
  "recentPurchases": [                                                              // newest 6 SUCCEEDED
    {
      "id": "…", "amountCents": 1900, "currency": "usd", "description": "…",
      "kind": "subscription",       // or "tokens" (from subscriptionId)
      "createdAt": "ISO",
      "user": { "id": 42, "name": "…", "email": "…" }
    }
  ]
}
```

Run the independent Prisma queries with `Promise.all`.

## 3. Wiring — two traps

1. **Route order.** `AdminController` owns `GET /admin/:id`, which matches any
   single segment. Import `PresenceModule` in `app.module.ts` **before**
   `AdminModule` (next to `AuditModule` / `AdminMailModule`, which are placed
   there for the same reason), or `/admin/city` is swallowed as `id="city"`.
2. **Audit log flood.** Every open tab POSTs every 20 s. In `isAuditable()`
   add `if (path.startsWith('/presence')) return false;` with a short comment,
   next to the existing `/admin/logs` exclusion.

## 4. Swagger

Tag `presence`, `@ApiOperation` summaries on both routes, `@ApiBearerAuth()` on
the admin route, `@ApiProperty` on every DTO field — so both appear on
`th-labs.uz/docs`.

## Constraints

- Assumes a single API instance (in-memory presence). Say so in the service's
  docblock; do not add Redis.
- Do not touch existing endpoints, payment logic, or other migrations.
- No new dependencies.
- Use `eslint --fix` only on files you created; don't reformat the repo.

## Definition of done

- `npx tsc --noEmit`, `npx eslint src/presence src/audit src/app.module.ts`,
  and `npx jest` all pass.
- Add a unit test for `PresenceService` (mock Prisma): a beat appears in
  `city().people`; a stale beat (>75 s) is pruned; `pageview: true` calls
  `siteVisit.upsert` and a keep-alive does not; `/presence` is not auditable.
- Manual check:
  ```bash
  curl -i -X POST localhost:3000/v1/presence -H 'Content-Type: application/json' \
    -d '{"visitorId":"v_test123456","site":"landing","path":"/","pageview":true}'
  # → 204
  curl -s "localhost:3000/v1/admin/city?from=$(date -u +%Y-%m-%dT00:00:00Z)" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.today, (.people | length)'
  # → visitors ≥ 1, people ≥ 1; and the same call without a token → 401
  ```
- `GET /v1/admin/city` and `POST /v1/presence` appear in `/docs-json`.

Reply with the list of files changed and the test output.
