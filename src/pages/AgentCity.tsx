import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { endpoints, isMissingRoute, streamLogs } from '../lib/api'
import { useQuery } from '../lib/useApi'
import type { CityPerson, CityResponse, LogRow } from '../lib/types'

/**
 * Agent City — the office TV.
 *
 * Every open tab on th-labs.uz and in the Studio beats to POST /v1/presence,
 * and GET /v1/admin/city hands back who is on which page plus today's
 * numbers. Each building here is one entry of the Studio's own sidebar, so
 * "Ada is in the Studio" means exactly that: she has /studio open.
 *
 * Written for a screen nobody touches: big plain-language numbers, a spotlight
 * that tours the signed-in people on its own, and a banner when someone signs
 * up or buys. Names are shortened to "Ada L." — a TV in an office is public.
 */

const POLL_MS = 5_000
const SPOTLIGHT_MS = 4_500
const CELEBRATE_MS = 8_000
const MAX_PER_BUILDING = 6
/** A log action this recent still describes what someone is doing. */
const RECENT_ACTION_MS = 3 * 60_000

/* ------------------------------- the city -------------------------------- */

type PlaceId =
  | 'website'
  | 'home'
  | 'studio'
  | 'tts'
  | 'works'
  | 'realtime'
  | 'tools'
  | 'docs'
  | 'developers'
  | 'billing'
  | 'settings'

interface Place {
  id: PlaceId
  name: string
  /** What someone here is doing when nothing more specific is known. */
  idle: string
  gx: number
  gy: number
  h: number
  hue: number
}

/**
 * The Studio sidebar, as a 4×3 block grid. gx runs down-right, gy down-left,
 * so (3,2) is the corner nearest the viewer — the Website is the city gate.
 */
const PLACES: Place[] = [
  { id: 'docs', name: 'Docs', idle: 'Reading the docs', gx: 0, gy: 0, h: 58, hue: 38 },
  { id: 'developers', name: 'Developers', idle: 'Checking the developer page', gx: 1, gy: 0, h: 50, hue: 280 },
  { id: 'settings', name: 'Settings', idle: 'Changing their settings', gx: 2, gy: 0, h: 40, hue: 215 },
  { id: 'billing', name: 'Plans and billing', idle: 'Looking at plans', gx: 3, gy: 0, h: 72, hue: 45 },
  { id: 'works', name: 'My works', idle: 'Browsing their works', gx: 0, gy: 1, h: 72, hue: 330 },
  { id: 'studio', name: 'Studio', idle: 'In the Studio', gx: 1, gy: 1, h: 132, hue: 214 },
  { id: 'tts', name: 'Text to speech', idle: 'Turning text into speech', gx: 2, gy: 1, h: 92, hue: 168 },
  { id: 'realtime', name: 'Real-time dubbing', idle: 'Dubbing live', gx: 3, gy: 1, h: 104, hue: 262 },
  { id: 'tools', name: 'Tools', idle: 'Using the editor tools', gx: 0, gy: 2, h: 60, hue: 24 },
  { id: 'home', name: 'Home', idle: 'On the home screen', gx: 1, gy: 2, h: 54, hue: 199 },
  { id: 'website', name: 'Website', idle: 'Looking around th-labs.uz', gx: 3, gy: 2, h: 46, hue: 142 },
]

const PLACE = Object.fromEntries(PLACES.map((p) => [p.id, p])) as Record<PlaceId, Place>

/** Which building an open tab stands in — mirrors the Studio's routes. */
function placeFor(person: Pick<CityPerson, 'site' | 'path'>): PlaceId {
  if (person.site === 'landing') return 'website'
  const p = person.path
  if (p.startsWith('/studio')) return 'studio'
  if (p.startsWith('/tts')) return 'tts'
  if (p.startsWith('/works')) return 'works'
  if (p.startsWith('/realtime')) return 'realtime'
  if (p.startsWith('/editor') || p.startsWith('/video-editor')) return 'tools'
  if (p.startsWith('/docs')) return 'docs'
  if (p.startsWith('/developers')) return 'developers'
  if (p.startsWith('/plans')) return 'billing'
  if (p.startsWith('/account')) return 'settings'
  return 'home'
}

/* ------------------------------- geometry -------------------------------- */

const VB_W = 760
const VB_H = 540
const STEP = 100
const ORIGIN_X = VB_W / 2 - STEP / 2
const ORIGIN_Y = 196
const BW = 42
const PAD = 58

function iso(gx: number, gy: number) {
  return { x: ORIGIN_X + (gx - gy) * STEP, y: ORIGIN_Y + (gx + gy) * (STEP / 2) }
}

function rhombus(cx: number, cy: number, w: number) {
  const d = w / 2
  return `${cx},${cy - d} ${cx + w},${cy} ${cx},${cy + d} ${cx - w},${cy}`
}

/** Deterministic 0–1 from a string, so windows don't flicker between renders. */
function hash01(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`

/* ------------------------------- wording --------------------------------- */

/** "Ada Lovelace" → "Ada L." — enough to recognise, not enough to doxx. */
function shortName(name: string | null | undefined, email?: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return email?.split('@')[0] ?? 'Someone'
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
}

function forHowLong(sinceIso: string, now: number) {
  const min = Math.floor((now - Date.parse(sinceIso)) / 60_000)
  if (min < 1) return 'just arrived'
  if (min < 60) return `for ${min} min`
  return `for ${Math.floor(min / 60)} h ${min % 60} min`
}

function money(revenue: Record<string, number>) {
  const entries = Object.entries(revenue)
  if (entries.length === 0) return '$0'
  return entries
    .map(([currency, cents]) =>
      (cents / 100).toLocaleString(undefined, {
        style: 'currency',
        currency: currency.toUpperCase(),
        maximumFractionDigits: cents % 100 ? 2 : 0,
      }),
    )
    .join(' + ')
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86_400)} d ago`
}

/* ------------------------------- live data ------------------------------- */

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

function startOfDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Today's numbers and presence, re-read every POLL_MS; rolls over at midnight. */
function useCity(now: number) {
  const from = startOfDay(now)
  const city = useQuery((signal) => endpoints.city(from, signal), [from])

  const refetch = useRef(city.refetch)
  useEffect(() => {
    refetch.current = city.refetch
  })
  useEffect(() => {
    const t = setInterval(() => refetch.current(), POLL_MS)
    return () => clearInterval(t)
  }, [])

  return city
}

/**
 * The activity log, live: the ticker along the bottom, and the "what are they
 * doing" line for anyone whose page did not say. The stream is a bonus — if it
 * cannot be opened the city still works, the ticker just stays still.
 */
function useActivity() {
  const [from] = useState(() => new Date(Date.now() - 15 * 60_000).toISOString())
  const initial = useQuery((signal) => endpoints.logs({ from, limit: 50 }, signal), [from])
  const [live, setLive] = useState<LogRow[]>([])

  useEffect(
    () =>
      streamLogs(
        (row) => setLive((prev) => [row, ...prev].slice(0, 100)),
        () => {},
      ),
    [],
  )

  return useMemo(() => {
    const seen = new Set<string>()
    return [...live, ...(initial.data?.rows ?? [])]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }, [live, initial.data])
}

interface Celebration {
  key: string
  emoji: string
  text: string
}

/** A banner whenever the newest signup or purchase changes after first load. */
function useCelebrations(data: CityResponse | null) {
  const [current, setCurrent] = useState<Celebration | null>(null)
  const last = useRef<{ signup?: number; purchase?: string } | null>(null)

  useEffect(() => {
    if (!data) return
    const signup = data.recentSignups[0]
    const purchase = data.recentPurchases[0]
    const prev = last.current
    last.current = { signup: signup?.id, purchase: purchase?.id }
    if (!prev) return // first load: what is already there is not news

    let next: Celebration | null = null
    if (purchase && purchase.id !== prev.purchase) {
      next = {
        key: `p${purchase.id}`,
        emoji: '💳',
        text: `${shortName(purchase.user.name, purchase.user.email)} just bought ${
          purchase.kind === 'subscription' ? 'a subscription' : 'tokens'
        }!`,
      }
    } else if (signup && signup.id !== prev.signup) {
      next = {
        key: `s${signup.id}`,
        emoji: '🎉',
        text: `${shortName(signup.name, signup.email)} just created an account!`,
      }
    }
    if (!next) return
    setCurrent(next)
    const t = setTimeout(() => setCurrent(null), CELEBRATE_MS)
    return () => clearTimeout(t)
  }, [data])

  return current
}

/* -------------------------------- render --------------------------------- */

export function AgentCity() {
  const now = useNow(1_000)
  const city = useCity(now)
  const activity = useActivity()
  const celebration = useCelebrations(city.data)

  const people = useMemo(() => city.data?.people ?? [], [city.data])
  const today = city.data?.today

  // Each signed-in person's latest logged action, if it is recent enough to
  // still describe what they are doing.
  const lastAction = useMemo(() => {
    const out = new Map<number, string>()
    for (const row of activity) {
      if (row.actorId == null || out.has(row.actorId)) continue
      if (now - Date.parse(row.createdAt) > RECENT_ACTION_MS) continue
      out.set(row.actorId, row.summary || row.action)
    }
    return out
  }, [activity, now])

  const doing = (p: CityPerson) =>
    p.doing ?? (p.user && lastAction.get(p.user.id)) ?? PLACE[placeFor(p)].idle

  const byPlace = useMemo(() => {
    const out = {} as Record<PlaceId, CityPerson[]>
    for (const p of PLACES) out[p.id] = []
    // Signed-in people first, so the few drawn per building are the ones with
    // a name; anonymous visitors still count in the building's total.
    for (const p of [...people].sort((a, b) => Number(!!b.user) - Number(!!a.user))) {
      out[placeFor(p)].push(p)
    }
    return out
  }, [people])

  // The spotlight tours signed-in people on its own — nobody clicks a TV.
  const named = people.filter((p) => p.user)
  const spotlight = named.length ? named[Math.floor(now / SPOTLIGHT_MS) % named.length] : null

  const onSite = people.filter((p) => p.site === 'landing').length
  const inApp = people.length - onSite

  return (
    <div className="tv">
      <header className="tv-head">
        <div className="tv-title">
          Agent City <span className="tv-by">TH-Labs</span>
        </div>
        <div className="spacer" />
        <span className={`tv-live${city.error ? ' off' : ''}`}>
          <span className="dot" />
          {city.error ? 'offline' : 'live'}
        </span>
        <div className="tv-clock">
          {clock(now)}
          <span>
            {new Date(now).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
        </div>
        <div className="tv-actions">
          <button
            type="button"
            className="tv-btn"
            onClick={() =>
              document.fullscreenElement
                ? void document.exitFullscreen()
                : void document.documentElement.requestFullscreen?.()
            }
          >
            Full screen
          </button>
          <Link to="/" className="tv-btn">
            Back to panel
          </Link>
        </div>
      </header>

      <section className="tv-stats">
        <BigStat
          label="People here right now"
          value={city.data ? people.length : null}
          note={`${onSite} on the website · ${inApp} in the app`}
          tone="live"
        />
        <BigStat
          label="Visitors today"
          value={today?.visitors}
          note={today ? `${today.pageviews.toLocaleString()} pages opened` : undefined}
        />
        <BigStat
          label="New accounts today"
          value={today?.signups}
          note="People who signed up"
          tone="good"
        />
        <BigStat
          label="Purchases today"
          value={today?.purchases}
          note={
            today
              ? `${today.subscriptions} subscriptions · ${today.tokenPacks} token packs`
              : undefined
          }
          tone="gold"
        />
        <BigStat label="Tokens sold today" value={today?.tokensSold} note="Bought by customers" />
        <BigStat
          label="Earned today"
          text={today ? money(today.revenue) : undefined}
          note="From successful payments"
          tone="gold"
        />
      </section>

      <main className="tv-main">
        <div className="tv-city">
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="tv-svg" aria-hidden="true">
            <defs>
              <radialGradient id="tv-moon" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
                <stop offset="0.25" stopColor="#c7d2fe" stopOpacity="0.35" />
                <stop offset="1" stopColor="#c7d2fe" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={VB_W * 0.84} cy={50} r={40} fill="url(#tv-moon)" />
            <Ground />
            {/* Painter's order: back rows first. */}
            {[...PLACES]
              .sort((a, b) => a.gx + a.gy - (b.gx + b.gy))
              .map((p) => (
                <Building key={p.id} place={p} crowd={byPlace[p.id].length} />
              ))}
            <Park />
          </svg>

          {PLACES.map((p) => {
            const c = iso(p.gx, p.gy)
            const count = byPlace[p.id].length
            return (
              <div
                key={p.id}
                className={`tv-label${count ? ' busy' : ''}`}
                style={{ left: pct(c.x, VB_W), top: pct(c.y - BW / 2 - p.h - 8, VB_H) }}
              >
                {p.name}
                {count > 0 && <span className="tv-label-count">{count}</span>}
              </div>
            )
          })}

          {PLACES.flatMap((place) => {
            const here = byPlace[place.id].slice(0, MAX_PER_BUILDING)
            const c = iso(place.gx, place.gy)
            return here.map((p, i) => {
              const x = c.x + (i - (here.length - 1) / 2) * 15
              const y = c.y + BW / 2 + 12 + (i % 2) * 6
              const fresh = now - Date.parse(p.since) < 15_000 && !!p.user
              const open = spotlight?.visitorId === p.visitorId || fresh
              return (
                <div
                  // Keyed by browser, across every building, so moving to a
                  // new page animates as a walk across town.
                  key={p.visitorId}
                  className={`tv-agent${p.user ? ` role-${p.user.role.toLowerCase()}` : ' visitor'}`}
                  style={{ left: pct(x, VB_W), top: pct(y, VB_H), zIndex: open ? 5 : 2 }}
                >
                  <span className="tv-agent-body" />
                  {open && p.user && (
                    <span className="tv-bubble">
                      <span className="tv-bubble-name">
                        {shortName(p.user.name, p.user.email)}
                        <span className="tv-bubble-where">
                          in {place.name} · {forHowLong(p.since, now)}
                        </span>
                      </span>
                      <span className="tv-bubble-text">{doing(p)}</span>
                    </span>
                  )}
                </div>
              )
            })
          })}

          {(city.initialLoading || city.error || people.length === 0) && (
            <div className="tv-empty">
              {city.initialLoading
                ? 'Waking the city up…'
                : isMissingRoute(city.error)
                  ? 'Agent City needs the latest API — GET /v1/admin/city is not deployed yet.'
                  : city.error
                    ? `Cannot reach the API: ${city.error.message}`
                    : 'The streets are quiet — nobody is online right now.'}
            </div>
          )}

          {celebration && (
            <div className="tv-celebrate" key={celebration.key}>
              <span className="tv-celebrate-emoji">{celebration.emoji}</span>
              {celebration.text}
            </div>
          )}
        </div>

        <aside className="tv-side">
          <div className="tv-panel">
            <h2>Who is online</h2>
            {named.length === 0 ? (
              <p className="tv-muted">
                {people.length
                  ? `${people.length} visitor${people.length === 1 ? '' : 's'}, nobody signed in yet`
                  : 'Nobody yet'}
              </p>
            ) : (
              <ul className="tv-list">
                {named.slice(0, 7).map((p) => (
                  <li key={p.visitorId} className={spotlight === p ? 'on' : ''}>
                    <span className={`tv-dot role-${p.user!.role.toLowerCase()}`} />
                    <div>
                      <strong>{shortName(p.user!.name, p.user!.email)}</strong>
                      <span className="tv-where">{PLACE[placeFor(p)].name}</span>
                      <div className="tv-muted">{doing(p)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="tv-panel">
            <h2>Just joined</h2>
            <ul className="tv-list compact">
              {(city.data?.recentSignups ?? []).slice(0, 5).map((u) => (
                <li key={u.id}>
                  <span className="tv-emoji">👋</span>
                  <strong>{shortName(u.name, u.email)}</strong>
                  <span className="tv-muted">{ago(u.createdAt, now)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="tv-panel">
            <h2>Just bought</h2>
            {city.data?.recentPurchases.length ? (
              <ul className="tv-list compact">
                {city.data.recentPurchases.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <span className="tv-emoji">{p.kind === 'subscription' ? '⭐' : '🪙'}</span>
                    <strong>{shortName(p.user.name, p.user.email)}</strong>
                    <span className="tv-buy">
                      {p.kind === 'subscription' ? 'subscription' : 'tokens'} ·{' '}
                      {money({ [p.currency]: p.amountCents })}
                    </span>
                    <span className="tv-muted">{ago(p.createdAt, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tv-muted">No purchases yet</p>
            )}
          </div>
        </aside>
      </main>

      <footer className="tv-ticker">
        {activity.slice(0, 4).map((r) => (
          <div key={r.id} className={`tv-ticker-row${r.success ? '' : ' failed'}`}>
            <span className="tv-ticker-time">{clock(Date.parse(r.createdAt))}</span>
            <strong>{r.actorEmail ? shortName(null, r.actorEmail) : 'System'}</strong>{' '}
            {r.summary || r.action}
          </div>
        ))}
      </footer>
    </div>
  )
}

function BigStat({
  label,
  value,
  text,
  note,
  tone = '',
}: {
  label: string
  value?: number | null
  /** Pre-formatted, for money. */
  text?: string
  note?: string
  tone?: '' | 'live' | 'good' | 'gold'
}) {
  const shown = text ?? (value == null ? '—' : value.toLocaleString())
  return (
    <div className={`tv-stat ${tone}`}>
      <div className="tv-stat-label">{label}</div>
      <div className="tv-stat-value">{shown}</div>
      {note && <div className="tv-stat-note">{note}</div>}
    </div>
  )
}

function Ground() {
  const n = iso(-0.7, -0.7)
  const e = iso(3.7, -0.7)
  const s = iso(3.7, 2.7)
  const wv = iso(-0.7, 2.7)
  return (
    <>
      <polygon points={`${n.x},${n.y} ${e.x},${e.y} ${s.x},${s.y} ${wv.x},${wv.y}`} className="tv-ground" />
      <polygon
        points={`${wv.x},${wv.y} ${s.x},${s.y} ${s.x},${s.y + 14} ${wv.x},${wv.y + 14}`}
        className="tv-slab-l"
      />
      <polygon
        points={`${s.x},${s.y} ${e.x},${e.y} ${e.x},${e.y + 14} ${s.x},${s.y + 14}`}
        className="tv-slab-r"
      />
      {[0.5, 1.5, 2.5].map((k) => {
        const a = iso(k, -0.7)
        const b = iso(k, 2.7)
        return <line key={`x${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="tv-road" />
      })}
      {[0.5, 1.5].map((k) => {
        const a = iso(-0.7, k)
        const b = iso(3.7, k)
        return <line key={`y${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="tv-road" />
      })}
      {[0.5, 1.5, 2.5].flatMap((i) =>
        [0.5, 1.5].map((j) => {
          const p = iso(i, j)
          return (
            <g key={`${i}-${j}`}>
              <circle cx={p.x} cy={p.y - 14} r={9} className="tv-lamp-glow" />
              <line x1={p.x} y1={p.y} x2={p.x} y2={p.y - 14} className="tv-lamp-post" />
              <circle cx={p.x} cy={p.y - 14} r={2} className="tv-lamp" />
            </g>
          )
        }),
      )}
    </>
  )
}

/** The one empty block becomes a little park, so the grid doesn't read as missing. */
function Park() {
  const c = iso(2, 2)
  const trees = [
    [-22, -4],
    [8, -10],
    [24, 4],
    [-6, 10],
  ]
  return (
    <g>
      <polygon points={rhombus(c.x, c.y, PAD)} className="tv-park" />
      {trees.map(([dx, dy], i) => (
        <g key={i}>
          <line x1={c.x + dx} y1={c.y + dy} x2={c.x + dx} y2={c.y + dy - 8} className="tv-trunk" />
          <circle cx={c.x + dx} cy={c.y + dy - 14} r={8} className="tv-tree" />
        </g>
      ))}
    </g>
  )
}

function Building({ place, crowd }: { place: Place; crowd: number }) {
  const c = iso(place.gx, place.gy)
  const half = BW / 2
  const W = { x: c.x - BW, y: c.y }
  const S = { x: c.x, y: c.y + half }
  const E = { x: c.x + BW, y: c.y }
  const lift = (p: { x: number; y: number }) => `${p.x},${p.y - place.h}`

  // More people inside, more lights on.
  const lit = Math.min(0.95, 0.18 + crowd * 0.12)
  const rows = Math.max(1, Math.floor(place.h / 14))
  const cols = 4

  const windows = (face: string) =>
    Array.from({ length: rows * cols }, (_, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const on = hash01(`${place.id}${face}${i}`) < lit
      return (
        <rect
          key={i}
          x={(col + 0.28) / cols}
          y={(row + 0.3) / rows}
          width={0.44 / cols}
          height={0.42 / rows}
          className={on ? 'tv-win on' : 'tv-win'}
        />
      )
    })

  return (
    <g className={`tv-building${crowd ? ' busy' : ''}`}>
      <polygon points={rhombus(c.x, c.y, PAD)} className="tv-pad" />
      <polygon
        points={`${W.x},${W.y} ${S.x},${S.y} ${lift(S)} ${lift(W)}`}
        fill={`hsl(${place.hue} 45% 34%)`}
      />
      <polygon
        points={`${S.x},${S.y} ${E.x},${E.y} ${lift(E)} ${lift(S)}`}
        fill={`hsl(${place.hue} 45% 24%)`}
      />
      <polygon points={rhombus(c.x, c.y - place.h, BW)} fill={`hsl(${place.hue} 55% 62%)`} />
      {/* Unit square → wall face, so window grids are drawn in 0–1 space.
          v runs up the wall, hence the negative height. */}
      <g transform={`matrix(${BW} ${half} 0 ${-place.h} ${W.x} ${W.y})`}>{windows('l')}</g>
      <g transform={`matrix(${BW} ${-half} 0 ${-place.h} ${S.x} ${S.y})`}>{windows('r')}</g>
    </g>
  )
}
