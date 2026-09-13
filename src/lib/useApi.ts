import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

export interface QueryState<T> {
  data: T | null
  error: ApiError | Error | null
  loading: boolean
  /** True only on the first load, so refetches don't blank the screen. */
  initialLoading: boolean
  refetch: () => void
}

/**
 * Minimal fetch-on-mount hook with abort + manual refetch.
 *
 * `deps` controls when the query re-runs. The fetcher itself is held in a ref
 * so callers can pass an inline arrow function without causing a loop.
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Held in a ref so callers can pass an inline arrow without retriggering the
  // query. Assigned in an effect (not during render) and declared before the
  // fetching effect below, so it is always current by the time that one runs.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setLoading(true)
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setInitialLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  return { data, error, loading, initialLoading, refetch }
}

/**
 * Wraps a mutating call with pending/error state so forms and destructive
 * buttons don't each reimplement it.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | Error | null>(null)

  // Same reasoning as useQuery: keep `mutate` stable across renders while still
  // calling the latest closure. Only ever read from event handlers, never render.
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      throw normalized
    } finally {
      setPending(false)
    }
  }, [])

  return { mutate, pending, error, reset: () => setError(null) }
}
