import { describe, expect, it } from 'vitest'
import { beforeSend, normalizeAnalyticsPath } from './analytics'

describe('normalizeAnalyticsPath', () => {
  it('collapses a record id to its route pattern', () => {
    expect(normalizeAnalyticsPath('/users/412')).toBe('/users/[id]')
    // The point of the exercise: two records, one row in the dashboard.
    expect(normalizeAnalyticsPath('/users/9')).toBe(normalizeAnalyticsPath('/users/412'))
  })

  it('leaves static routes untouched', () => {
    for (const path of ['/', '/login', '/users', '/admins', '/wait-list', '/billing']) {
      expect(normalizeAnalyticsPath(path)).toBe(path)
    }
  })

  it('does not mistake a word for an id', () => {
    // Only all-digit segments are ids — "wait-list" and "v1" must survive.
    expect(normalizeAnalyticsPath('/wait-list')).toBe('/wait-list')
    expect(normalizeAnalyticsPath('/users/me')).toBe('/users/me')
  })
})

describe('beforeSend', () => {
  const event = (url: string) => ({ type: 'pageview' as const, url })

  it('rewrites the path and keeps the pageview', () => {
    const out = beforeSend(event('https://admin.th-labs.uz/users/412'))
    expect(out?.url).toBe('https://admin.th-labs.uz/users/[id]')
    expect(out?.type).toBe('pageview')
  })

  it('drops the query string and hash', () => {
    const out = beforeSend(event('https://admin.th-labs.uz/users?page=2#top'))
    expect(out?.url).toBe('https://admin.th-labs.uz/users')
  })

  it('drops an event it cannot parse rather than reporting it raw', () => {
    expect(beforeSend(event('not-a-url'))).toBeNull()
  })
})
