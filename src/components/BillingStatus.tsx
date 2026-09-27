import { formatNumber } from '../lib/format'
import type { BillingOverview } from '../lib/types'
import { Badge, ErrorState, StatusRow } from './ui'
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

  return (
    <div className="section">
      {/*
        The webhook is the only failure that stays invisible until a customer
        has already paid, so it gets the loudest treatment on the page and sits
        above everything else.
      */}
      {!data.webhookConfigured && (
        <div className="alert critical" style={{ marginBottom: 14 }}>
          <div className="alert-body">
            <strong>Payments are accepted but no credits will be granted.</strong>
            Webhooks are the only thing that grants credits. Until{' '}
            <code>DODO_WEBHOOK_SECRET</code> is set on the API, a customer can pay and receive
            nothing — and the checkout itself will look like it worked.
          </div>
        </div>
      )}

      <div className="card card-pad">
        <div className="status-head">
          <h2>Billing health</h2>
          <div className="spacer" />
          <Badge tone={data.mode === 'live' ? 'green' : 'amber'}>
            <span className="dot" />
            {String(data.mode).toUpperCase()} MODE
          </Badge>
          <Badge>{data.provider}</Badge>
          <button className="btn btn-sm" onClick={onRetry}>
            <IconRefresh />
            Refresh
          </button>
        </div>

        <div className="status-list">
          <StatusRow
            severity={data.webhookConfigured ? 'ok' : 'critical'}
            title={data.webhookConfigured ? 'Webhook configured' : 'Webhook NOT configured'}
          >
            {data.webhookConfigured
              ? 'Paid invoices will grant credits.'
              : 'Set DODO_WEBHOOK_SECRET on the API.'}
          </StatusRow>

          <StatusRow
            severity={data.apiConfigured ? 'ok' : 'warn'}
            title={data.apiConfigured ? 'Dodo API key configured' : 'No Dodo API key'}
          >
            {data.apiConfigured
              ? 'Hosted checkout, cancellation and the customer portal are available.'
              : 'Static payment links only — cancel and the customer portal are switched off.'}
          </StatusRow>

          {data.mode === 'test' && (
            <StatusRow severity="warn" title="Test mode">
              No real money moves. Checkout uses Dodo's test environment.
            </StatusRow>
          )}

          {data.links?.mixed && (
            <StatusRow severity="warn" title="Live mode is pointed at test checkout links">
              {data.links.live} live and {data.links.test} test links are configured at once.
              Customers sent to a test link cannot actually pay.
            </StatusRow>
          )}

          {planIssues.length > 0 && (
            <StatusRow severity="warn" title={`${planIssues.length} plan(s) cannot be bought`}>
              No Dodo product attached: {planIssues.join(', ')}.
            </StatusRow>
          )}

          {packIssues.length > 0 && (
            <StatusRow
              severity="warn"
              title={`${packIssues.length} credit pack(s) cannot be bought`}
            >
              No Dodo product attached: {packIssues.join(', ')}.
            </StatusRow>
          )}

          {data.webhookConfigured &&
            data.apiConfigured &&
            !data.links?.mixed &&
            !planIssues.length &&
            !packIssues.length && (
              <StatusRow severity="ok" title="Everything is wired up">
                {data.plans?.sellable ?? 0} of {data.plans?.total ?? 0} plans and{' '}
                {data.creditPacks?.active ?? 0} of {data.creditPacks?.total ?? 0} credit packs are
                ready to sell.
              </StatusRow>
            )}
        </div>

        <div className="status-facts">
          <Fact label="Plans" value={`${data.plans?.sellable ?? 0} sellable / ${data.plans?.total ?? 0}`} />
          <Fact
            label="Credit packs"
            value={`${data.creditPacks?.active ?? 0} active / ${data.creditPacks?.total ?? 0}`}
          />
          <Fact label="Checkout links" value={`${data.links?.live ?? 0} live · ${data.links?.test ?? 0} test`} />
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

