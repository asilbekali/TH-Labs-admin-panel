import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { IconAlert, IconCheck, IconInfo } from './icons'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void
  /** Convenience for catch blocks — pulls the message off any thrown value. */
  toastError: (error: unknown, fallback?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = nextId++
      setToasts((list) => [...list, { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500)
    },
    [dismiss],
  )

  const toastError = useCallback(
    (error: unknown, fallback = 'Something went wrong') => {
      const message = error instanceof Error && error.message ? error.message : fallback
      toast(message, 'error')
    },
    [toast],
  )

  const value = useMemo(() => ({ toast, toastError }), [toast, toastError])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.kind === 'success' && <IconCheck />}
            {t.kind === 'error' && <IconAlert />}
            {t.kind === 'info' && <IconInfo />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
