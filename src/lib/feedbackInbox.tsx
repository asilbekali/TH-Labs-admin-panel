import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { endpoints } from './api'

/**
 * How many feedback messages nobody has triaged yet, shared across the panel.
 *
 * This exists as a context rather than a hook each screen calls for two
 * reasons. One count, one request: the sidebar badge, the dashboard tile and
 * the inbox all read the same number, so they cannot disagree — a badge saying
 * "3" next to an empty inbox is worse than no badge. And triage has to be able
 * to push it down immediately: `refresh()` after a PATCH means the badge drops
 * the moment someone deals with a message, instead of up to a poll later.
 *
 * The count comes from the server's own `total` (see untriagedFeedbackCount),
 * never from counting rows on a page — a page of rows would cap the badge at
 * its own length and quietly under-report a busy inbox, which is the one
 * failure mode that makes an unread badge worth less than nothing.
 */
const POLL_MS = 60_000

interface FeedbackInboxValue {
  /** null until the first read settles, or when the endpoint is unavailable. */
  count: number | null
  /** True while the very first read is in flight. */
  loading: boolean
  /** Re-read now — call it after triaging so the badge drops immediately. */
  refresh: () => void
}

const FeedbackInboxContext = createContext<FeedbackInboxValue | null>(null)

export function FeedbackInboxProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Stable, so the polling effect below can depend on it without the interval
  // being torn down and rebuilt — which would drift the schedule every time
  // anything triggered a manual refresh.
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    endpoints
      .untriagedFeedbackCount(controller.signal)
      .then((n) => {
        if (!cancelled) setCount(n)
      })
      .catch(() => {
        // A 403 (not staff), a 404 (older API build) or a dropped connection.
        // None of those are worth a banner for a badge — stay silent and leave
        // the count unknown rather than showing a confident zero.
        if (!cancelled) setCount(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [nonce])

  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS)

    // Coming back to the tab is the moment the number is most likely to be
    // stale and most likely to be looked at, so re-read then too.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const value = useMemo<FeedbackInboxValue>(
    () => ({ count, loading, refresh }),
    [count, loading, refresh],
  )

  return <FeedbackInboxContext.Provider value={value}>{children}</FeedbackInboxContext.Provider>
}

/**
 * Safe outside the provider — returns a null count rather than throwing, so a
 * screen rendered on the login side of the router does not have to care.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useFeedbackInbox(): FeedbackInboxValue {
  return (
    useContext(FeedbackInboxContext) ?? { count: null, loading: false, refresh: () => undefined }
  )
}
