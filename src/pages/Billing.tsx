import { endpoints, unwrapList } from '../lib/api'
import { useQuery } from '../lib/useApi'
import { displayValue, formatCents, formatNumber, humanizeKey } from '../lib/format'
import type { LedgerRow, Plan } from '../lib/types'
import { Badge, EmptyState, ErrorState, InfoNote, TableSkeleton } from '../components/ui'
import { IconRefresh } from '../components/icons'

const TIER_TONE: Record<string, string> = {
  FREE: '',
  PRO: 'blue',
  STUDIO: 'violet',
}

export function Billing() {
  const plans = useQuery((signal) => endpoints.plans(signal))
  const subscription = useQuery((signal) => endpoints.subscription(signal))
  const credits = useQuery((signal) => endpoints.credits(1, 20, signal))
  const history = useQuery((signal) => endpoints.paymentHistory(1, 20, signal))

  const planRows: Plan[] = plans.data?.plans ?? []

  return (
    <>
      <p className="page-intro">
        Plan catalogue and billing state. Plans are global; the subscription, credit and payment
        panels below are scoped to your own account.
      </p>

      <InfoNote title="Billing endpoints are self-scoped" tone="warn">
        The API's payment routes (<code>/v1/payments/subscription</code>, <code>/credits</code>,{' '}
        <code>/history</code>) all read the <em>authenticated caller's</em> billing record. There is
        no admin route to read another user's subscription or credit ledger, so per-user billing
        cannot be shown on the user detail page until the backend adds one.
      </InfoNote>

      {/* ------------------------------- Plans ------------------------------ */}
      <div className="section" style={{ marginTop: 24 }}>
        <div className="section-head">
          <h2>Plans</h2>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={plans.refetch} disabled={plans.loading}>
            <IconRefresh />
            Refresh
          </button>
        </div>

        {plans.error && <ErrorState error={plans.error} onRetry={plans.refetch} />}

        {plans.initialLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : (
          !plans.error && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Cycle</th>
                    <th>Price</th>
                    <th>Credits</th>
                    <th>Grant window</th>
                    <th>Status</th>
                    <th>Checkout</th>
                  </tr>
                </thead>
                <tbody>
                  {planRows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Badge tone={TIER_TONE[p.tier] ?? ''}>{p.tier}</Badge>
                      </td>
                      <td>{p.cycle}</td>
                      <td className="nowrap">{formatCents(p.priceCents)}</td>
                      <td>{formatNumber(p.creditsGranted)}</td>
                      <td className="nowrap">
                        {p.grantDays} days
                        {p.grantsPerPeriod > 1 ? ` × ${p.grantsPerPeriod}` : ''}
                      </td>
                      <td>
                        {p.active ? (
                          <Badge tone="green">
                            <span className="dot" />
                            Active
                          </Badge>
                        ) : (
                          <Badge>Inactive</Badge>
                        )}
                      </td>
                      <td>
                        {p.stripeLinkUrl ? (
                          <a
                            className="btn btn-sm"
                            href={p.stripeLinkUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Stripe link
                          </a>
                        ) : (
                          <span className="mono">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!planRows.length && <EmptyState title="No plans returned" />}
            </div>
          )
        )}
      </div>

      {/* -------------------------- Your subscription ----------------------- */}
      <div className="section">
        <div className="section-head">
          <h2>Your subscription</h2>
        </div>
        {subscription.initialLoading ? (
          <TableSkeleton rows={2} cols={3} />
        ) : subscription.error ? (
          <ErrorState error={subscription.error} onRetry={subscription.refetch} />
        ) : (
          <RecordCard value={subscription.data} empty="No subscription on this account." />
        )}
      </div>

      {/* ------------------------------ Credits ----------------------------- */}
      <div className="section">
        <div className="section-head">
          <h2>Your credits</h2>
        </div>
        {credits.initialLoading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : credits.error ? (
          <ErrorState error={credits.error} onRetry={credits.refetch} />
        ) : (
          <LedgerPanel payload={credits.data} empty="No credit ledger entries." />
        )}
      </div>

      {/* ------------------------- Payment history -------------------------- */}
      <div className="section">
        <div className="section-head">
          <h2>Your payment history</h2>
        </div>
        {history.initialLoading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={history.refetch} />
        ) : (
          <LedgerPanel payload={history.data} empty="No payments recorded." />
        )}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Generic renderers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * These payment responses are undocumented in the spec, so rather than guess at
 * a column layout we render whatever scalar fields come back.
 */
function RecordCard({ value, empty }: { value: unknown; empty: string }) {
  const record = pickRecord(value)
  const scalars = record
    ? Object.entries(record).filter(([, v]) => v === null || typeof v !== 'object')
    : []

  if (!scalars.length) {
    return (
      <div className="card">
        <EmptyState title={empty} />
      </div>
    )
  }

  return (
    <div className="prop-grid">
      {scalars.map(([key, v]) => (
        <div className="prop" key={key}>
          <div className="prop-key">{humanizeKey(key)}</div>
          <div className="prop-val">{displayValue(v)}</div>
        </div>
      ))}
    </div>
  )
}

/** Balance summary (scalars) plus the ledger rows, whatever they're named. */
function LedgerPanel({ payload, empty }: { payload: unknown; empty: string }) {
  const rows = unwrapList<LedgerRow>(payload)
  const record = pickRecord(payload)
  const summary = record
    ? Object.entries(record).filter(([, v]) => v === null || typeof v !== 'object')
    : []

  const columns = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.entries(row).forEach(([k, v]) => {
        if (v === null || typeof v !== 'object') set.add(k)
      })
      return set
    }, new Set()),
  ).slice(0, 7)

  return (
    <>
      {summary.length > 0 && (
        <div className="prop-grid" style={{ marginBottom: 12 }}>
          {summary.map(([key, v]) => (
            <div className="prop" key={key}>
              <div className="prop-key">{humanizeKey(key)}</div>
              <div className="prop-val">{displayValue(v)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="table-wrap">
        {rows.length > 0 ? (
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{humanizeKey(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={String(row.id ?? i)}>
                  {columns.map((c) => (
                    <td key={c}>{displayValue(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title={empty} />
        )}
      </div>
    </>
  )
}

function pickRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
