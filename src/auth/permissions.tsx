import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { Modal } from '../components/Modal'
import { IconLock } from '../components/icons'

/**
 * SUPERADMIN-only actions, shown to an ADMIN as well — locked.
 *
 * Hiding a button an ADMIN cannot use leaves them guessing whether the feature
 * exists at all. So the action stays on screen with a lock, and pressing it
 * explains who can do it instead of firing a request the API will refuse with
 * a 403. The server remains the authority: every call is still handled if it
 * is refused there.
 */

interface PermissionContextValue {
  isSuperAdmin: boolean
  /**
   * Call at the top of a SUPERADMIN-only handler. Returns true to proceed;
   * for anyone else it opens the "no access" dialog and returns false.
   */
  requireSuperAdmin: (action: string) => boolean
}

const PermissionContext = createContext<PermissionContextValue | null>(null)

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin } = useAuth()
  const [denied, setDenied] = useState<string | null>(null)

  const requireSuperAdmin = useCallback(
    (action: string) => {
      if (isSuperAdmin) return true
      setDenied(action)
      return false
    },
    [isSuperAdmin],
  )

  const value = useMemo(
    () => ({ isSuperAdmin, requireSuperAdmin }),
    [isSuperAdmin, requireSuperAdmin],
  )

  return (
    <PermissionContext.Provider value={value}>
      {children}
      {denied && (
        <Modal
          title="You don't have access to do this"
          onClose={() => setDenied(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setDenied(null)}>
              Got it
            </button>
          }
        >
          <div className="no-access">
            <div className="no-access-icon">
              <IconLock />
            </div>
            <p>
              <strong>{capitalize(denied)}</strong> is reserved for <strong>SUPERADMIN</strong>.
              You are signed in as <code>{user?.role ?? 'ADMIN'}</code>.
            </p>
            <p className="text-faint">
              Ask a super admin to do it for you, or to change your role on the Users page.
            </p>
          </div>
        </Modal>
      )}
    </PermissionContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePermissions() {
  const ctx = useContext(PermissionContext)
  if (!ctx) throw new Error('usePermissions must be used inside <PermissionProvider>')
  return ctx
}

/**
 * A SUPERADMIN-only icon button. Rendered for everyone; for an ADMIN it wears
 * a lock and opens the no-access dialog instead of running `onClick`.
 */
export function GuardedIconButton({
  action,
  title,
  danger,
  onClick,
  children,
}: {
  /** Lower-case phrase for the dialog: "deleting users". */
  action: string
  title: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const { isSuperAdmin, requireSuperAdmin } = usePermissions()

  return (
    <button
      type="button"
      className={`btn btn-icon${danger ? ' danger' : ''}${isSuperAdmin ? '' : ' locked'}`}
      title={isSuperAdmin ? title : `${title} — SUPERADMIN only`}
      aria-label={title}
      onClick={() => {
        if (requireSuperAdmin(action)) onClick()
      }}
    >
      {children}
      {!isSuperAdmin && (
        <span className="lock-pip" aria-hidden="true">
          <IconLock />
        </span>
      )}
    </button>
  )
}

/** A whole page an ADMIN cannot use. */
export function AccessDenied({ what }: { what: string }) {
  const { user } = useAuth()
  return (
    <div className="access-denied">
      <div className="no-access-icon lg">
        <IconLock />
      </div>
      <h2>You don't have access to {what}</h2>
      <p>
        This area is reserved for <strong>SUPERADMIN</strong>. Your account signs in as{' '}
        <code>{user?.role ?? 'ADMIN'}</code>.
      </p>
      <Link className="btn" to="/">
        Back to dashboard
      </Link>
    </div>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
