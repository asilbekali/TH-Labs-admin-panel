import { formatNumber } from '../lib/format'
import type { BillingOverview } from '../lib/types'
import { Badge, CopyValue, ErrorState, StatusRow } from './ui'
import { IconRefresh } from './icons'

/* -------------------------------------------------------------------------- */
/* Billing health                                                              */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

export function BillingStatus({
  data,
  loading,
  error,
  onRetry,
}: {
  data: BillingOverview | null
  loading: boolean
  error: Error | null
  onRetry: () => void
}) {
  if (loading) {
    return <div className="skeleton" style={{ height: 150, marginBottom: 20 }} />
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!data) return null

  const planIssues = data.plans?.unconfigured ?? []
  const packIssues = data.creditPacks?.unconfigured ?? []

  const ready = data.canGrantCredits && !planIssues.length && !packIssues.length

  return (
    <div className="section">
      {/*
        Without the Lemon Squeezy API key the API cannot ask LS whether an order
        was paid, so nothing can ever be credited. It gets the loudest treatment
        on the page and sits above everything else.
      */}
      {!data.canGrantCredits && (
        <div className="alert critical" style={{ marginBottom: 14 }}>
          <div className="alert-body">
            <strong>Purchases cannot grant credits.</strong>
            Until <code>LEMONSQUEEZY_API_KEY</code> is set on the API there is no way to verify
            that an order was paid, so the site keeps every Buy button disabled.
          </div>
        </div>
      )}

      <div className="card card-pad">
        <div className="status-head">
          <h2>Billing health</h2>
          <div className="spacer" />
          <Badge>{data.provider === 'lemonsqueezy' ? 'Lemon Squeezy' : data.provider}</Badge>
          <button className="btn btn-sm" onClick={onRetry}>
            <IconRefresh />
            Refresh
          </button>
        </div>

        <div className="status-list">
          <StatusRow
            severity={data.canGrantCredits ? 'ok' : 'critical'}
            title={
              data.canGrantCredits
                ? 'Lemon Squeezy API key configured'
                : 'Lemon Squeezy API key NOT configured'
            }
          >
            {data.canGrantCredits
              ? 'Paid orders are verified with Lemon Squeezy and credited.'
              : 'Set LEMONSQUEEZY_API_KEY on the API.'}
          </StatusRow>

          <StatusRow severity="ok" title="No webhook needed">
            {data.webhook?.note ??
              'Purchases are found by polling the Lemon Squeezy API for the account’s orders.'}
          </StatusRow>

          {planIssues.length > 0 && (
            <StatusRow severity="warn" title={`${planIssues.length} plan(s) cannot be bought`}>
              Missing a checkout link or variant id: {planIssues.join(', ')}.
            </StatusRow>
          )}

          {packIssues.length > 0 && (
            <StatusRow
              severity="warn"
              title={`${packIssues.length} credit pack(s) cannot be bought`}
            >
              Missing a checkout link or variant id: {packIssues.join(', ')}.
            </StatusRow>
          )}

          {ready && (
            <StatusRow severity="ok" title="Everything is wired up">
              {data.plans?.sellable ?? 0} of {data.plans?.total ?? 0} plans and{' '}
              {data.creditPacks?.active ?? 0} of {data.creditPacks?.total ?? 0} credit packs are
              ready to sell.
            </StatusRow>
          )}
        </div>

        {data.successUrl && (
          <div className="status-success-url">
            <div className="fact-key">Success URL</div>
            <CopyValue value={data.successUrl} />
            <p className="text-muted" style={{ marginTop: 6, fontSize: 13 }}>
              Set this as the redirect / confirmation button link on every Lemon Squeezy product,
              so buyers come straight back and are credited in seconds. Without it they are still
              credited by the background poll within about five minutes.
            </p>
          </div>
        )}

        <div className="status-facts">
          <Fact label="Plans" value={`${data.plans?.sellable ?? 0} sellable / ${data.plans?.total ?? 0}`} />
          <Fact
            label="Credit packs"
            value={`${data.creditPacks?.active ?? 0} active / ${data.creditPacks?.total ?? 0}`}
          />
          <Fact label="Credits per minute" value={formatNumber(data.tariff?.creditsPerMinute)} />
          {Object.entries(data.qualityCost ?? {}).map(([quality, cost]) => (
            <Fact key={quality} label={`Cost · ${quality}`} value={`${formatNumber(cost)} credits`} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <div className="fact-key">{label}</div>
      <div className="fact-val">{value}</div>
    </div>
  )
}

