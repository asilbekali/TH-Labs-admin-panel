import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The break room: three short games for a quiet shift. Nothing here touches
 * the API — best scores live in this browser only.
 */

type GameId = 'squash' | 'memory' | 'reaction'

const GAMES: Array<{ id: GameId; emoji: string; title: string; blurb: string }> = [
  { id: 'squash', emoji: '🐛', title: 'Bug Squash', blurb: '30 seconds. Squash bugs, spare the features.' },
  { id: 'memory', emoji: '🧠', title: 'Memory Match', blurb: 'Flip cards, find the pairs, fewest moves wins.' },
  { id: 'reaction', emoji: '⚡', title: 'Reaction Test', blurb: 'Wait for green. Click. How fast are you?' },
]

/* -------------------------------------------------------------------------- */
/* Best scores — per browser, never required                                   */
/* -------------------------------------------------------------------------- */

const BEST_KEY = 'th-admin-games-best'

function readBest(): Partial<Record<GameId, number>> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Partial<Record<GameId, number>>
  } catch {
    return {}
  }
}

/** `lowerIsBetter` for moves and milliseconds. Returns true on a new record. */
function saveBest(game: GameId, score: number, lowerIsBetter = false): boolean {
  const best = readBest()
  const prev = best[game]
  const better = prev == null || (lowerIsBetter ? score < prev : score > prev)
  if (!better) return false
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ ...best, [game]: score }))
  } catch {
    /* storage refused — the record just isn't kept */
  }
  return true
}

export function Games() {
  const [game, setGame] = useState<GameId>('squash')
  const [best, setBest] = useState(readBest)

  const record = useCallback((id: GameId, score: number, lowerIsBetter?: boolean) => {
    const isRecord = saveBest(id, score, lowerIsBetter)
    setBest(readBest())
    return isRecord
  }, [])

  return (
    <>
      <p className="page-intro">
        Inbox quiet? Take five. Scores stay in this browser — nobody is watching the leaderboard.
      </p>

      <div className="game-picker">
        {GAMES.map((g) => (
          <button
            key={g.id}
            className={`game-card${game === g.id ? ' on' : ''}`}
            onClick={() => setGame(g.id)}
          >
            <span className="game-emoji">{g.emoji}</span>
            <span className="game-title">{g.title}</span>
            <span className="game-blurb">{g.blurb}</span>
            <span className="game-best">
              Best:{' '}
              {best[g.id] == null
                ? '—'
                : g.id === 'squash'
                  ? `${best[g.id]} pts`
                  : g.id === 'memory'
                    ? `${best[g.id]} moves`
                    : `${best[g.id]} ms`}
            </span>
          </button>
        ))}
      </div>

      <div className="card card-pad game-stage">
        {game === 'squash' && <BugSquash onFinish={(s) => record('squash', s)} />}
        {game === 'memory' && <MemoryMatch onFinish={(m) => record('memory', m, true)} />}
        {game === 'reaction' && <ReactionTest onFinish={(ms) => record('reaction', ms, true)} />}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Bug Squash                                                                  */
/* -------------------------------------------------------------------------- */

const HOLES = 9
const ROUND_SECONDS = 30

type Critter = { kind: 'bug' | 'feature'; id: number } | null

function BugSquash({ onFinish }: { onFinish: (score: number) => boolean }) {
  const [running, setRunning] = useState(false)
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS)
  const [score, setScore] = useState(0)
  const [holes, setHoles] = useState<Critter[]>(() => Array(HOLES).fill(null))
  const [result, setResult] = useState<{ score: number; record: boolean } | null>(null)
  const scoreRef = useRef(0)
  const nextId = useRef(1)
  const onFinishRef = useRef(onFinish)
  useEffect(() => {
    onFinishRef.current = onFinish
  })

  useEffect(() => {
    if (!running) return

    // Read off the wall clock rather than counting ticks, so a throttled
    // background tab cannot stretch the round.
    const endsAt = Date.now() + ROUND_SECONDS * 1000
    const clock = setInterval(() => {
      const left = Math.max(Math.ceil((endsAt - Date.now()) / 1000), 0)
      setTimeLeft(left)
      if (left === 0) {
        setRunning(false)
        setHoles(Array(HOLES).fill(null))
        setResult({ score: scoreRef.current, record: onFinishRef.current(scoreRef.current) })
      }
    }, 250)

    // Spawns speed up as the round goes on.
    let spawnTimer: ReturnType<typeof setTimeout>
    const started = Date.now()
    const spawn = () => {
      const elapsed = (Date.now() - started) / 1000
      const at = Math.floor(Math.random() * HOLES)
      const id = nextId.current++
      const kind = Math.random() < 0.2 ? 'feature' : 'bug'
      // An occupied hole just skips this spawn.
      setHoles((prev) => (prev[at] ? prev : prev.map((c, i) => (i === at ? { kind, id } : c))))
      // Each critter ducks back down on its own if not hit in time.
      setTimeout(
        () => setHoles((h) => h.map((c) => (c?.id === id ? null : c))),
        Math.max(1100 - elapsed * 20, 550),
      )
      spawnTimer = setTimeout(spawn, Math.max(700 - elapsed * 15, 300))
    }
    spawn()

    return () => {
      clearInterval(clock)
      clearTimeout(spawnTimer)
    }
  }, [running])

  function start() {
    scoreRef.current = 0
    setScore(0)
    setTimeLeft(ROUND_SECONDS)
    setResult(null)
    setHoles(Array(HOLES).fill(null))
    setRunning(true)
  }

  function hit(i: number) {
    const critter = holes[i]
    if (!running || !critter) return
    const delta = critter.kind === 'bug' ? 1 : -3
    scoreRef.current = Math.max(scoreRef.current + delta, 0)
    setScore(scoreRef.current)
    setHoles((h) => h.map((c, j) => (j === i ? null : c)))
  }

  return (
    <div className="game">
      <div className="game-hud">
        <span>
          Score <strong>{score}</strong>
        </span>
        <span>
          Time <strong>{timeLeft}s</strong>
        </span>
        <span className="text-faint">🐛 +1 · ✨ feature −3</span>
      </div>

      <div className="squash-grid">
        {holes.map((c, i) => (
          <button
            key={i}
            className={`hole${c ? ` up ${c.kind}` : ''}`}
            onClick={() => hit(i)}
            aria-label={c ? (c.kind === 'bug' ? 'Bug' : 'Feature') : 'Empty hole'}
          >
            <span className="critter">{c ? (c.kind === 'bug' ? '🐛' : '✨') : ''}</span>
          </button>
        ))}
      </div>

      {!running && (
        <div className="game-overlay">
          {result && (
            <p className="game-result">
              {result.record ? '🏆 New best! ' : ''}You squashed <strong>{result.score}</strong>{' '}
              point{result.score === 1 ? '' : 's'} of bugs.
            </p>
          )}
          <button className="btn btn-primary" onClick={start}>
            {result ? 'Play again' : 'Start squashing'}
          </button>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Memory Match                                                                */
/* -------------------------------------------------------------------------- */

// Studio-flavoured faces: voice, film, languages, sound.
const FACES = ['🎙️', '🎬', '🌍', '🎧', '🔊', '🎞️', '💬', '🚀']

interface Card {
  id: number
  face: string
  open: boolean
  matched: boolean
}

function shuffledDeck(): Card[] {
  const faces = [...FACES, ...FACES]
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[faces[i], faces[j]] = [faces[j], faces[i]]
  }
  return faces.map((face, id) => ({ id, face, open: false, matched: false }))
}

function MemoryMatch({ onFinish }: { onFinish: (moves: number) => boolean }) {
  const [deck, setDeck] = useState(shuffledDeck)
  const [picked, setPicked] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [result, setResult] = useState<{ moves: number; record: boolean } | null>(null)

  useEffect(() => {
    if (picked.length !== 2) return
    const [a, b] = picked
    const match = deck[a].face === deck[b].face
    const t = setTimeout(
      () => {
        const next = deck.map((c, i) =>
          i === a || i === b ? (match ? { ...c, matched: true } : { ...c, open: false }) : c,
        )
        setDeck(next)
        setPicked([])
        if (next.every((c) => c.matched)) setResult({ moves, record: onFinish(moves) })
      },
      match ? 250 : 750,
    )
    return () => clearTimeout(t)
  }, [picked, deck, moves, onFinish])

  function flip(i: number) {
    if (picked.length === 2 || deck[i].open || deck[i].matched) return
    setDeck((d) => d.map((c, j) => (j === i ? { ...c, open: true } : c)))
    const next = [...picked, i]
    setPicked(next)
    if (next.length === 2) setMoves((m) => m + 1)
  }

  function reset() {
    setDeck(shuffledDeck())
    setPicked([])
    setMoves(0)
    setResult(null)
  }

  return (
    <div className="game">
      <div className="game-hud">
        <span>
          Moves <strong>{moves}</strong>
        </span>
        <span>
          Pairs <strong>{deck.filter((c) => c.matched).length / 2}</strong> / {FACES.length}
        </span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={reset}>
          New deck
        </button>
      </div>

      <div className="memory-grid">
        {deck.map((c, i) => (
          <button
            key={c.id}
            className={`memory-card${c.open || c.matched ? ' open' : ''}${c.matched ? ' matched' : ''}`}
            onClick={() => flip(i)}
            aria-label={c.open || c.matched ? c.face : 'Hidden card'}
          >
            <span className="memory-inner">
              <span className="memory-back" />
              <span className="memory-front">{c.face}</span>
            </span>
          </button>
        ))}
      </div>

      {result && (
        <div className="game-overlay">
          <p className="game-result">
            {result.record ? '🏆 New best! ' : ''}All pairs in <strong>{result.moves}</strong> moves.
          </p>
          <button className="btn btn-primary" onClick={reset}>
            Play again
          </button>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Reaction Test                                                               */
/* -------------------------------------------------------------------------- */

type Phase = 'idle' | 'waiting' | 'go' | 'early' | 'done'

function ReactionTest({ onFinish }: { onFinish: (ms: number) => boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ms, setMs] = useState<number | null>(null)
  const [record, setRecord] = useState(false)
  const goAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function press() {
    if (phase === 'idle' || phase === 'done' || phase === 'early') {
      setPhase('waiting')
      setMs(null)
      setRecord(false)
      timer.current = setTimeout(
        () => {
          goAt.current = performance.now()
          setPhase('go')
        },
        1200 + Math.random() * 2800,
      )
    } else if (phase === 'waiting') {
      if (timer.current) clearTimeout(timer.current)
      setPhase('early')
    } else if (phase === 'go') {
      const took = Math.round(performance.now() - goAt.current)
      setMs(took)
      setRecord(onFinish(took))
      setPhase('done')
    }
  }

  const label: Record<Phase, string> = {
    idle: 'Click to start',
    waiting: 'Wait for green…',
    go: 'CLICK!',
    early: 'Too soon! Click to try again',
    done: `${ms} ms${record ? ' — 🏆 new best!' : ''} · click to go again`,
  }

  return (
    <div className="game">
      <button
        className={`reaction-pad ${phase}`}
        onMouseDown={press}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            press()
          }
        }}
      >
        <span className="reaction-label">{label[phase]}</span>
        {phase === 'done' && ms != null && <span className="reaction-verdict">{verdict(ms)}</span>}
      </button>
    </div>
  )
}

function verdict(ms: number) {
  if (ms < 200) return 'Lightning reflexes ⚡'
  if (ms < 280) return 'Sharp 👌'
  if (ms < 380) return 'Not bad 🙂'
  return 'Coffee time? ☕'
}
