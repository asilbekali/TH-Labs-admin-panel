import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { setAccessToken } from '../lib/api'

/**
 * Role locks, the password reveal, staff email and the break room — against a
 * stubbed API that records every write, so a test can say both what the
 * screen showed and what it did (or did not) send.
 */

const ADMIN = {
  id: 5,
  email: 'admin@th-labs.uz',
  name: 'Plain Admin',
  role: 'ADMIN',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const SUPERADMIN = { ...ADMIN, id: 1, email: 'super@th-labs.uz', name: 'Super', role: 'SUPERADMIN' }

const FEEDBACK = {
  id: 7,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Dub drifts',
  message: 'The voice drifts out of sync after three minutes.',
  kind: 'BUG',
  status: 'NEW',
  rating: null,
  pagePath: null,
  userId: 42,
  adminNote: null,
  userAgent: null,
  createdAt: new Date().toISOString(),
}

interface Write {
  method: string
  url: string
  body: unknown
}

let writes: Write[] = []

function stubApi({
  me,
  signedIn = true,
  mailStatus = 200,
}: {
  me: typeof ADMIN
  signedIn?: boolean
  mailStatus?: number
}) {
  writes = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET' && !url.includes('/auth/')) {
        writes.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      }

      const reply = (status: number, payload: unknown) =>
        Promise.resolve({
          ok: status < 400,
          status,
          text: () => Promise.resolve(payload == null ? '' : JSON.stringify(payload)),
          json: () => Promise.resolve(payload),
        } as Response)

      if (url.includes('/auth/refresh')) {
        return signedIn ? reply(200, { accessToken: 'tok', user: me }) : reply(401, { statusCode: 401, message: 'Unauthorized' })
      }
      if (url.includes('/admin/mail')) {
        if (mailStatus === 404) return reply(404, { statusCode: 404, message: 'Cannot POST /v1/admin/mail' })
        return reply(200, { total: 1, sent: 1, failed: [] })
      }
      if (url.includes('/users/all-users-data')) {
        return reply(200, [
          me,
          { id: 42, email: 'ada@example.com', name: 'Ada', role: 'USER', createdAt: '2026-09-01T00:00:00.000Z' },
        ])
      }
      if (url.includes('/feedback')) {
        if (method === 'PATCH') return reply(200, { ...FEEDBACK, status: 'RESOLVED' })
        return reply(200, { rows: [FEEDBACK], total: 1, page: 1, limit: 25 })
      }
      if (url.includes('/health')) return reply(200, { mode: 'ok', database: 'up', pipeline: 'up' })
      return reply(200, [])
    }),
  )
}

beforeEach(() => {
  setAccessToken(null)
  try {
    localStorage.clear()
  } catch {
    /* not needed */
  }
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
  await waitFor(() => expect(screen.queryByText(/Restoring session/i)).toBeNull())
}

describe('login', () => {
  it('shows and hides the password', async () => {
    stubApi({ me: ADMIN, signedIn: false })
    await open('/login')

    const field = document.querySelector('input[autocomplete="current-password"]') as HTMLInputElement
    expect(field.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field.type).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(field.type).toBe('password')
  })

  it('shows the TH-Labs logo', async () => {
    stubApi({ me: ADMIN, signedIn: false })
    await open('/login')
    expect(screen.getByAltText('TH-Labs')).toBeTruthy()
  })
})

describe('role locks for an ADMIN', () => {
  it("locks the role button on the ADMIN's own row and explains instead of calling the API", async () => {
    stubApi({ me: ADMIN })
    await open('/users')

    const ownRow = (await screen.findByText('admin@th-labs.uz')).closest('tr')!
    const ownButton = within(ownRow).getByRole('button', { name: 'Change role' })
    expect(ownButton.className).toContain('locked')

    fireEvent.click(ownButton)
    expect(await screen.findByText(/You don't have access to do this/)).toBeTruthy()
    expect(screen.getByText(/Changing this account's role/)).toBeTruthy()
    expect(writes).toEqual([])
  })

  it('lets an ADMIN make a USER an ADMIN, but never offers SUPERADMIN', async () => {
    stubApi({ me: ADMIN })
    await open('/users')

    const adaRow = (await screen.findByText('ada@example.com')).closest('tr')!
    const button = within(adaRow).getByRole('button', { name: 'Change role' })
    expect(button.className).not.toContain('locked')

    fireEvent.click(button)
    const dialog = (await screen.findByText("Change this user's role")).closest('[role="dialog"]') ?? document.body
    const select = (dialog as HTMLElement).querySelector('select')!
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['USER', 'ADMIN'])

    fireEvent.change(select, { target: { value: 'ADMIN' } })
    fireEvent.click(document.querySelector('button[form="change-role-form"]')!)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'PATCH', body: { role: 'ADMIN' } })
    expect(writes[0].url).toMatch(/\/users\/42\/role$/)
  })

  it('shows an access-denied page for admin records', async () => {
    stubApi({ me: ADMIN })
    await open('/admins')
    expect(await screen.findByText(/You don't have access to admin records/)).toBeTruthy()
  })

  it('does not lock anything for a SUPERADMIN', async () => {
    stubApi({ me: SUPERADMIN })
    await open('/users')
    const roleButtons = await screen.findAllByRole('button', { name: 'Change role' })
    expect(roleButtons[0].className).not.toContain('locked')
  })
})

describe('staff email', () => {
  it('replies to feedback and marks it resolved with a note', async () => {
    stubApi({ me: ADMIN })
    await open('/feedback')

    fireEvent.click(await screen.findByText(/Dub drifts/))
    fireEvent.click(screen.getByRole('button', { name: /Reply by email/ }))

    const message = await screen.findByPlaceholderText('Write your message…')
    fireEvent.change(message, { target: { value: 'Fixed in today’s release — thanks!' } })
    fireEvent.click(screen.getByRole('button', { name: /Send email/ }))

    await waitFor(() => expect(writes.some((w) => w.method === 'PATCH')).toBe(true))

    const mail = writes.find((w) => w.url.endsWith('/admin/mail'))
    expect(mail?.body).toMatchObject({
      recipients: [{ email: 'ada@example.com', name: 'Ada Lovelace' }],
      subject: 'Re: Dub drifts',
      feedbackId: 7,
    })
    const patch = writes.find((w) => w.method === 'PATCH')
    expect(patch?.body).toMatchObject({ status: 'RESOLVED' })
    expect((patch?.body as { adminNote?: string } | undefined)?.adminNote).toMatch(/Replied by email/)
  })

  it('offers the mail app when the API build has no mail route', async () => {
    stubApi({ me: ADMIN, mailStatus: 404 })
    await open('/mail?to=ada@example.com')

    fireEvent.change(await screen.findByPlaceholderText('About your dub from yesterday'), {
      target: { value: 'Hello' },
    })
    fireEvent.change(screen.getByPlaceholderText('Write your message…'), {
      target: { value: 'A note from the team.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send email/ }))

    const link = (await screen.findByText(/Open in mail app/)).closest('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toMatch(/^mailto:ada@example\.com\?subject=Hello/)
  })
})

describe('break room', () => {
  it('lists the games', async () => {
    stubApi({ me: ADMIN })
    await open('/games')
    expect(screen.getAllByText('Bug Squash').length).toBeGreaterThan(0)
    expect(screen.getByText('Memory Match')).toBeTruthy()
    expect(screen.getByText('Reaction Test')).toBeTruthy()
  })
})
