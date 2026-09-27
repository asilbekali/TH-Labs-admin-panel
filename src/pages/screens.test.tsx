import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setAccessToken } from '../lib/api'

/**
 * Renders the real screens against a stubbed API that returns the documented
 * shapes, so a screen that throws on a field it did not expect fails here
 * rather than in front of an admin.
 *
 * The billing assertions are the point of the file: a missing webhook means a
 * customer can pay and receive nothing, and that has to be the loudest thing
 * on the page rather than a field in a table.
 */

const SUPERADMIN = {
  id: 1,
  email: 'super@th-labs.uz',
  name: 'Super Admin',
  role: 'SUPERADMIN',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const OVERVIEW = {
  provider: 'dodo',
  mode: 'test',
  apiConfigured: true,
  webhookConfigured: false,
  plans: { total: 7, sellable: 6, unconfigured: ['PRO/MONTHLY'] },
  creditPacks: { total: 4, active: 4, unconfigured: ['pack_240'] },
  links: { live: 0, test: 4, mixed: false },
  qualityCost: { fast: 5, balanced: 10, studio: 20 },
  tariff: { creditsPerMinute: 53, qualityMultiplier: { fast: 1 } },
}

const PLANS = [
  {
    id: 'plan_pro_monthly',
    tier: 'PRO',
    cycle: 'MONTHLY',
    priceCents: 1900,
    creditsGranted: 1200,
    grantDays: 30,
    grantsPerPeriod: 1,
    dodoProductId: null,
    dodoLinkUrl: null,
    active: true,
    configured: false,
    sellable: true,
    creditsPerPeriod: 1200,
    linkIsTestMode: false,
  },
]

const PACKS = [
  {
    id: 'pack_1',
    slug: 'pack_240',
    credits: 240,
    priceCents: 500,
    currency: 'USD',
    popular: true,
    sortOrder: 1,
    dodoProductId: 'pdt_live_1',
    dodoLinkUrl: 'https://checkout.dodopayments.com/buy/pdt_live_1',
    active: true,
    configured: true,
    linkIsTestMode: true,
  },
]

const LOG_ROW = {
  id: 'log_1',
  createdAt: new Date().toISOString(),
  actorId: 1,
  actorEmail: 'super@th-labs.uz',
  actorRole: 'SUPERADMIN',
  action: 'user.role.change',
  method: 'PATCH',
  path: '/users/42',
  statusCode: 200,
  durationMs: 120,
  success: true,
  targetType: 'user',
  targetId: '42',
  targetLabel: 'ada@example.com',
  summary: 'Changed the role of ada@example.com',
  meta: { body: { role: 'ADMIN' } },
  ip: '10.0.0.1',
  userAgent: 'test-agent',
}

const FEEDBACK_NEW = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Uzbek dub drifts out of sync after ~3 minutes',
  message: 'The Uzbek voice starts fine but by minute three it is a second ahead of the lips.',
  kind: 'BUG',
  status: 'NEW',
  rating: 4,
  pagePath: '/studio',
  userId: 42,
  adminNote: null,
  userAgent: 'test-agent',
  createdAt: new Date().toISOString(),
}

const FEEDBACK_ANON = {
  id: 8,
  name: 'Someone',
  email: 'someone@example.com',
  subject: null,
  message: 'Please add Korean.',
  kind: 'FEATURE',
  status: 'RESOLVED',
  rating: null,
  pagePath: null,
  userId: null,
  adminNote: 'Shipped in 1.2.',
  userAgent: null,
  createdAt: '2026-09-02T00:00:00.000Z',
}

/**
 * The API's 404 envelope, as distinct from a static host's HTML 404 page. The
 * panel must reach opposite conclusions from the two — see the regression tests
 * at the bottom of this file.
 */
const API_404 = { statusCode: 404, message: 'Cannot GET /v1/admin/logs/actions' }

const HTML_404 =
  '<!DOCTYPE html><html lang="en"><body><h1>404</h1><p>This page could not be found.</p></body></html>'

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      const body = (() => {
        if (url.includes('/auth/refresh')) {
          return { ok: true, payload: { accessToken: 'tok', user: SUPERADMIN } }
        }
        if (url.includes('/admin/billing/overview')) return { ok: true, payload: OVERVIEW }
        if (url.includes('/admin/billing/plans')) return { ok: true, payload: PLANS }
        if (url.includes('/admin/billing/credit-packs')) return { ok: true, payload: PACKS }
        if (url.includes('/admin/logs/stream')) return { ok: false, payload: null }
        if (url.includes('/admin/logs/actions')) {
          return { ok: true, payload: ['user.role.change', 'billing.plan.update'] }
        }
        if (url.includes('/admin/logs/stats')) {
          return {
            ok: true,
            payload: {
              from: '', to: '', bucket: 'hour', total: 10, counted: 10, truncated: false,
              failed: 2, successRate: 0.8, avgDurationMs: 95,
              series: [{ at: new Date().toISOString(), total: 10, failed: 2 }],
              topActions: [], topActors: [],
            },
          }
        }
        if (url.includes('/admin/logs')) {
          return { ok: true, payload: { rows: [LOG_ROW], total: 1, page: 1, limit: 50 } }
        }
        if (url.includes('/users/all-users-data')) {
          return {
            ok: true,
            payload: [
              { ...SUPERADMIN, credits: 900 },
              {
                id: 42, email: 'ada@example.com', name: 'Ada', role: 'USER',
                credits: 60, freeDubUsed: false, createdAt: '2026-09-01T00:00:00.000Z',
              },
            ],
          }
        }
        if (url.includes('/feedback')) {
          // Honour the status filter, because the untriaged count is read off
          // `total` from exactly that query.
          const onlyNew = url.includes('status=NEW')
          const rows = onlyNew ? [FEEDBACK_NEW] : [FEEDBACK_NEW, FEEDBACK_ANON]
          return { ok: true, payload: { rows, total: rows.length, page: 1, limit: 25 } }
        }
        if (url.includes('/community')) {
          return {
            ok: true,
            payload: [{ id: 3, userName: 'Grace', email: 'grace@example.com', createdAt: '2026-09-10T00:00:00.000Z' }],
          }
        }
        if (url.includes('/health')) {
          return { ok: true, payload: { app: 'TH-LABS API', version: '1.0.0', mode: 'ok', ffmpeg: true, stages: [], database: 'up', pipeline: 'up' } }
        }
        return { ok: true, payload: [] }
      })()

      return Promise.resolve({
        ok: body.ok,
        status: body.ok ? 200 : 404,
        text: () => Promise.resolve(body.payload === null ? '' : JSON.stringify(body.payload)),
        json: () => Promise.resolve(body.payload),
      } as Response)
    }),
  )
}

beforeEach(() => {
  setAccessToken(null)
  stubApi()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function open(path: string) {
  window.history.pushState({}, '', path)
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  // Wait out the boot-time refresh.
  await waitFor(() => expect(screen.queryByText(/Restoring session/i)).toBeNull())
}

describe('billing screen', () => {
  it('makes an unconfigured webhook the loudest thing on the page', async () => {
    await open('/billing')

    await waitFor(() => {
      expect(
        screen.getByText(/Payments are accepted but no credits will be granted/i),
      ).toBeTruthy()
    })

    // It says what to do next, not just that something is wrong. Named in
    // both the banner and the status row, hence getAllByText.
    expect(screen.getAllByText(/DODO_WEBHOOK_SECRET/).length).toBeGreaterThan(0)
    // And it is rendered with the critical treatment, not a generic warning.
    expect(document.querySelector('.alert.critical')).toBeTruthy()
  })

  it('shows test mode and lists what cannot be bought', async () => {
    await open('/billing')

    await waitFor(() => expect(screen.getAllByText(/TEST/).length).toBeGreaterThan(0))
    // Each unconfigured item is named in the status list, and packs again in
    // their own table.
    expect(screen.getAllByText(/PRO\/MONTHLY/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/pack_240/).length).toBeGreaterThan(0)
  })

  it('renders an unconfigured plan as unbuyable and opens its editor', async () => {
    await open('/billing')

    await waitFor(() => expect(screen.getByText('Cannot be bought')).toBeTruthy())

    fireEvent.click(screen.getByTitle('Edit plan'))

    // One field takes either half of the Dodo product, as the API accepts both.
    expect(screen.getAllByText(/Dodo product id or payment link/i).length).toBeGreaterThan(0)
    expect(
      screen.getByPlaceholderText(/pdt_abc123/),
    ).toBeTruthy()
  })
})

describe('activity log', () => {
  it('renders rows as "who did what" and expands to the redacted meta', async () => {
    await open('/activity')

    await waitFor(() => {
      expect(screen.getByText(/Changed the role of ada@example.com/)).toBeTruthy()
    })
    expect(screen.getByText('super@th-labs.uz')).toBeTruthy()

    fireEvent.click(screen.getByText(/Changed the role of ada@example.com/))

    await waitFor(() => expect(screen.getByText(/secrets already redacted/i)).toBeTruthy())
    expect(screen.getByText(/"role": "ADMIN"/)).toBeTruthy()
  })
})

describe('users', () => {
  it('lists users with credits and offers a role change to a SUPERADMIN', async () => {
    await open('/users')

    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy())

    fireEvent.click(screen.getAllByTitle(/Change role/)[1])

    await waitFor(() => expect(screen.getByText(/Change this user's role/i)).toBeTruthy())
  })
})

describe('community', () => {
  it('lists members joined from the landing page', async () => {
    await open('/community')

    await waitFor(() => expect(screen.getByText('grace@example.com')).toBeTruthy())
  })
})

describe('dashboard', () => {
  it('leads with billing health and shows recent activity', async () => {
    await open('/')

    await waitFor(() => {
      expect(
        screen.getByText(/Payments are accepted but no credits will be granted/i),
      ).toBeTruthy()
    })
    expect(screen.getByText(/Changed the role of ada@example.com/)).toBeTruthy()
  })
})

describe('feedback inbox', () => {
  it('lists messages and exposes the triage controls', async () => {
    await open('/feedback')

    await waitFor(() =>
      expect(screen.getByText(/Uzbek dub drifts out of sync/)).toBeTruthy(),
    )
    // The sender and how to reach them, plus the kind, which is what you triage on.
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getAllByText('BUG').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText(/Uzbek dub drifts out of sync/))

    await waitFor(() => expect(screen.getByText(/Staff note/i)).toBeTruthy())
    // The message body itself, and a mailto so replying is one click.
    expect(screen.getByText(/by minute three it is a second ahead/)).toBeTruthy()
    expect(document.querySelector('a[href="mailto:ada@example.com"]')).toBeTruthy()
  })

  it('does not present an anonymous sender email as verified', async () => {
    await open('/feedback')

    await waitFor(() => expect(screen.getByText(/Please add Korean/)).toBeTruthy())
    fireEvent.click(screen.getByText(/Please add Korean/))

    // userId is null on that row, so the panel must say the address is
    // self-reported rather than implying the API vouched for it.
    await waitFor(() =>
      expect(screen.getByText(/name and email are self-reported/i)).toBeTruthy(),
    )
  })

  it('counts untriaged messages on the nav item so a new one gets noticed', async () => {
    await open('/')

    // One NEW row in the fixture, and the count has to come from the server's
    // own total for the NEW query — not from counting what is on screen.
    await waitFor(() => expect(document.querySelector('.nav-count')?.textContent).toBe('1'))

    const link = document.querySelector('.nav-count')?.closest('a')
    expect(link?.getAttribute('href')).toBe('/feedback')
  })
})

/* -------------------------------------------------------------------------- */
/* 404 is not one thing                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The regression these two tests guard.
 *
 * The panel used to treat every 404 as "this API build is missing the route",
 * which sent an operator off to redeploy a backend that was answering fine —
 * the real fault was that requests were landing on the marketing app, which
 * returns an HTML 404 for anything outside /v1. The two cases have to reach
 * opposite conclusions, so both directions are pinned.
 */
function stub404(payload: unknown, match: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/auth/refresh')) {
        const session = { accessToken: 'tok', user: SUPERADMIN }
        // refreshSession() reads json(), every other path reads text().
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(session)),
          json: () => Promise.resolve(session),
        } as Response)
      }

      if (url.includes(match)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () =>
            Promise.resolve(typeof payload === 'string' ? payload : JSON.stringify(payload)),
        } as Response)
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('[]'),
      } as Response)
    }),
  )
}

describe('a 404 from the API and a 404 from something else', () => {
  it("blames the API build when the API's own 404 envelope comes back", async () => {
    stub404(API_404, '/admin/logs')
    await open('/activity')

    await waitFor(() =>
      expect(screen.getByText(/This API build has no activity log endpoints/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/not talking to the API/i)).toBeNull()
  })

  it('blames the panel wiring when an HTML page comes back instead', async () => {
    stub404(HTML_404, '/admin/logs')
    await open('/activity')

    // The opposite conclusion, and it must name the fix — the route is fine,
    // the request never reached the API.
    await waitFor(() => expect(screen.getByText(/not talking to the API/i)).toBeTruthy())
    expect(screen.queryByText(/This API build has no activity log endpoints/i)).toBeNull()
    expect(screen.getAllByText(/th-labs\.uz\/v1/).length).toBeGreaterThan(0)
  })
})
