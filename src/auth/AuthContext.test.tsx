import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setAccessToken } from '../lib/api'

/**
 * Regression tests for the boot sequence.
 *
 * The bug these exist for: AuthProvider used a `booted` ref to run its refresh
 * effect only once. Under StrictMode the effect fires, its cleanup sets
 * cancelled = true, then the second invocation bails out on the ref — so the
 * only pass that could call setReady(true) had already been cancelled and the
 * app hung on "Restoring session…" forever.
 *
 * These render the real App inside StrictMode, which is how main.tsx mounts it,
 * so that interaction is actually exercised rather than assumed away.
 */

/** What a stubbed endpoint returns — `json` is sync here for brevity. */
interface MockResponse {
  ok?: boolean
  status?: number
  json?: () => unknown
}

function mockFetch(handler: (url: string) => MockResponse) {
  return vi.fn((input: RequestInfo | URL) => {
    const res = handler(String(input))
    const payload = res.json?.()
    return Promise.resolve({
      ok: res.ok ?? false,
      status: res.status ?? 200,
      // api.ts reads text() and parses it itself, so both must be present.
      text: () => Promise.resolve(payload === undefined ? '' : JSON.stringify(payload)),
      json: () => Promise.resolve(payload ?? null),
    } as Response)
  })
}

beforeEach(() => {
  window.history.pushState({}, '', '/')
  // The access token lives in module scope, so it would otherwise survive from
  // one test into the next.
  setAccessToken(null)
  // Same for the built-in admin's session flag.
  sessionStorage.clear()
})

afterEach(() => {
  // Explicit because `globals: false` disables Testing Library's auto-cleanup;
  // without this each test inherits the previous test's mounted tree.
  cleanup()
  vi.restoreAllMocks()
})

describe('boot sequence', () => {
  it('falls through to the login screen when refresh returns 401', async () => {
    // The signed-out case: no refresh cookie, so /auth/refresh 401s. This is
    // the exact scenario that used to hang.
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ ok: false, status: 401, json: () => ({ message: 'Missing refresh token' }) })),
    )

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(screen.getByText(/Restoring session/i)).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
    })
    expect(screen.queryByText(/Restoring session/i)).toBeNull()
  })

  it('restores an ADMIN session from the refresh cookie', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((url) => {
        if (url.includes('/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            json: () => ({
              accessToken: 'token-123',
              user: {
                id: 1,
                email: 'jane@th-labs.uz',
                name: 'Jane Doe',
                role: 'ADMIN',
                createdAt: new Date().toISOString(),
              },
            }),
          }
        }
        // Dashboard's data calls — empty collections are fine here.
        return { ok: true, status: 200, json: () => [] }
      }),
    )

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeTruthy()
    })
    // Landed in the panel, not on the login screen.
    expect(screen.getByText(/TH-Labs Studio/)).toBeTruthy()
  })

  it('refuses a USER-role session and shows the login screen', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((url) => {
        if (url.includes('/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            json: () => ({
              accessToken: 'token-123',
              user: {
                id: 9,
                email: 'bob@example.com',
                name: 'Bob',
                role: 'USER',
                createdAt: new Date().toISOString(),
              },
            }),
          }
        }
        return { ok: true, status: 200, json: () => [] }
      }),
    )

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
    })
    expect(screen.queryByText('Bob')).toBeNull()
  })

  it('only issues one refresh request despite StrictMode double-invoking', async () => {
    const fetchMock = mockFetch(() => ({ ok: false, status: 401, json: () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
    })

    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/auth/refresh'),
    )
    expect(refreshCalls).toHaveLength(1)
  })
})

/**
 * Fill in and submit the login form.
 *
 * Queried by placeholder rather than label: <Field> renders a bare <label>
 * with no htmlFor, so getByLabelText finds nothing.
 */
async function signIn(email: string, password: string) {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
  })
  fireEvent.change(screen.getByPlaceholderText(/@th-labs\.uz/i), {
    target: { value: email },
  })
  fireEvent.change(screen.getByPlaceholderText('••••••••'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('built-in default admin', () => {
  /** Nothing signed in, and /auth/login rejects whatever it is given. */
  function stubBackendWithoutAdmin() {
    vi.stubGlobal(
      'fetch',
      mockFetch((url) => {
        if (url.includes('/auth/login')) {
          return { ok: false, status: 401, json: () => ({ message: 'Invalid credentials' }) }
        }
        if (url.includes('/auth/refresh')) {
          return { ok: false, status: 401, json: () => ({ message: 'Missing refresh token' }) }
        }
        return { ok: false, status: 401, json: () => ({ message: 'Unauthorized' }) }
      }),
    )
  }

  it('signs in when the backend has no matching admin', async () => {
    stubBackendWithoutAdmin()

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await signIn('super@gmail.com', 'iamadmin')

    await waitFor(() => {
      expect(screen.getByText('Default Admin')).toBeTruthy()
    })
    // And it says so, rather than quietly pretending to be a real session.
    expect(screen.getByText(/default admin account/i)).toBeTruthy()
  })

  it('stays signed in when the panel 401s on its data calls', async () => {
    // Every page request comes back 401 because there is no access token. That
    // must not trigger the session-lost teardown for this account.
    stubBackendWithoutAdmin()

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await signIn('super@gmail.com', 'iamadmin')

    await waitFor(() => {
      expect(screen.getByText('Default Admin')).toBeTruthy()
    })
    // Give the dashboard's failing requests time to settle.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
  })

  it('still reports the real error for any other bad credentials', async () => {
    stubBackendWithoutAdmin()

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await signIn('super@gmail.com', 'wrong-password')

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
  })

  it('prefers a real backend admin over the built-in one', async () => {
    // Same credentials, but this backend accepts them — the API session wins
    // and no fallback banner appears.
    vi.stubGlobal(
      'fetch',
      mockFetch((url) => {
        if (url.includes('/auth/login')) {
          return {
            ok: true,
            status: 200,
            json: () => ({
              accessToken: 'token-123',
              user: {
                id: 7,
                email: 'super@gmail.com',
                name: 'Real Super',
                role: 'SUPERADMIN',
                createdAt: new Date().toISOString(),
              },
            }),
          }
        }
        if (url.includes('/auth/refresh')) return { ok: false, status: 401, json: () => ({}) }
        return { ok: true, status: 200, json: () => [] }
      }),
    )

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await signIn('super@gmail.com', 'iamadmin')

    await waitFor(() => {
      expect(screen.getByText('Real Super')).toBeTruthy()
    })
    expect(screen.queryByText(/default admin account/i)).toBeNull()
  })
})
