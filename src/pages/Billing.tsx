import { useMemo, useState, type FormEvent } from 'react'
import { endpoints, isMissingRoute } from '../lib/api'
import { useMutation, useQuery } from '../lib/useApi'
import { formatCents, formatNumber } from '../lib/format'
import {
  SLUG_PATTERN,
  type BillingPlan,
  type CreateCreditPackInput,
  type CreditPack,
  type UpdateCreditPackInput,
  type UpdatePlanInput,
} from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { BillingStatus } from '../components/BillingStatus'
import { ConfirmDialog, Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import {
  Badge,
  CopyValue,
  EmptyState,
  ErrorState,
  Field,
  InfoNote,
  MissingRouteNote,
  TableSkeleton,
} from '../components/ui'
import { IconEdit, IconPlus, IconRefresh, IconTrash } from '../components/icons'

const TIER_TONE: Record<string, string> = { FREE: '', PRO: 'blue', STUDIO: 'violet' }

export function Billing() {
  const overview = useQuery((signal) => endpoints.billingOverview(signal))
  const plans = useQuery((signal) => endpoints.billingPlans(signal))
  const packs = useQuery((signal) => endpoints.creditPacks(signal))

  // All three live behind /admin/billing, so one 404 means the whole feature
  // is absent from this API build rather than any single call failing.
  const missing = isMissingRoute(overview.error) || isMissingRoute(plans.error)

  function refetchAll() {
    overview.refetch()
    plans.refetch()
    packs.refetch()
  }

  if (missing) {
    return (
      <>
        <p className="page-intro">
          Plans, credit packs and the Dodo Payments wiring behind them.
        </p>
        <MissingRouteNote
          what="admin billing"
          routes={['/v1/admin/billing/overview', '/v1/admin/billing/plans']}
        />
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={refetchAll}>
            <IconRefresh />
            Try again
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <p className="page-intro">
        Plans, credit packs and the Dodo Payments wiring behind them. Every number here comes
        from the API — nothing on this screen is hardcoded.
      </p>

      <BillingStatus
        data={overview.data}
        loading={overview.initialLoading}
        error={overview.error}
        onRetry={overview.refetch}
      />

      <PlansSection query={plans} />
      <CreditPacksSection query={packs} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

function PlansSection({ query }: { query: ReturnType<typeof useQuery<BillingPlan[]>> }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const rows = query.data ?? []

  return (
    <div className="section">
      <div className="section-head">
        <h2>Plans</h2>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={query.refetch} disabled={query.loading}>
          <IconRefresh />
          Refresh
        </button>
      </div>

      <InfoNote title="Plans are fixed — you attach products to them">
        There is no endpoint to create or delete a plan. Paste a Dodo product id or payment link
        into a plan to put it on sale; clear that field to take it off sale without deactivating
        it.
      </InfoNote>

      {query.error && <ErrorState error={query.error} onRetry={query.refetch} />}

      {query.initialLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : (
        !query.error && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Credits</th>
                  <th>Grant</th>
                  <th>Dodo product</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((plan) => (
                  <PlanRow
                    key={plan.id}
                    plan={plan}
                    editing={editingId === plan.id}
                    onEdit={() => setEditingId(plan.id)}
                    onClose={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null)
                      query.refetch()
                    }}
                  />
                ))}
              </tbody>
            </table>
            {!rows.length && <EmptyState title="No plans returned" />}
          </div>
        )
      )}
    </div>
  )
}

function PlanRow({
  plan,
  editing,
  onEdit,
  onClose,
  onSaved,
}: {
  plan: BillingPlan
  editing: boolean
  onEdit: () => void
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <>
      <tr className={editing ? 'row-editing' : undefined}>
        <td>
          <div className="plan-name">
            <Badge tone={TIER_TONE[plan.tier] ?? ''}>{plan.tier}</Badge>
            <span className="text-muted">{plan.cycle}</span>
          </div>
        </td>
        <td className="nowrap">{formatCents(plan.priceCents)}</td>
        <td className="nowrap">
          {formatNumber(plan.creditsGranted)}
          {plan.grantsPerPeriod > 1 && (
            <span className="text-faint"> × {plan.grantsPerPeriod}</span>
          )}
        </td>
        <td className="nowrap text-muted">every {plan.grantDays}d</td>
        <td style={{ maxWidth: 240 }}>
          <CopyValue value={plan.dodoProductId} empty="Not attached" />
        </td>
        <td>
          <PlanStatus plan={plan} />
        </td>
        <td className="actions">
          <button
            className="btn btn-icon"
            onClick={editing ? onClose : onEdit}
            title={editing ? 'Close editor' : 'Edit plan'}
          >
            <IconEdit />
          </button>
        </td>
      </tr>

      {editing && (
        <tr className="row-editor">
          <td colSpan={7}>
            <PlanEditor plan={plan} onCancel={onClose} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  )
}

function PlanStatus({ plan }: { plan: BillingPlan }) {
  if (!plan.sellable) return <Badge>Not for sale</Badge>
  if (!plan.active) return <Badge>Inactive</Badge>
  if (!plan.configured) return <Badge tone="amber">Cannot be bought</Badge>
  return (
    <div className="badge-stack">
      <Badge tone="green">
        <span className="dot" />
        On sale
      </Badge>
      {plan.linkIsTestMode && <Badge tone="amber">test link</Badge>}
    </div>
  )
}

/**
 * Inline plan editor.
 *
 * Every field on the PATCH body is optional, so only what actually changed is
 * sent — otherwise saving one field would rewrite the others with whatever was
 * on screen when the form opened.
 */
function PlanEditor({
  plan,
  onCancel,
  onSaved,
}: {
  plan: BillingPlan
  onCancel: () => void
  onSaved: () => void
}) {
  const { toast, toastError } = useToast()

  // The server derives the id from a link and vice versa, so one field holds
  // whichever half the operator has to hand.
  const initialProduct = plan.dodoLinkUrl || plan.dodoProductId || ''

  const [product, setProduct] = useState(initialProduct)
  const [priceCents, setPriceCents] = useState(String(plan.priceCents))
  const [creditsGranted, setCreditsGranted] = useState(String(plan.creditsGranted))
  const [grantDays, setGrantDays] = useState(String(plan.grantDays))
  const [grantsPerPeriod, setGrantsPerPeriod] = useState(String(plan.grantsPerPeriod))
  const [active, setActive] = useState(plan.active)

  const update = useMutation((input: UpdatePlanInput) => endpoints.updatePlan(plan.id, input))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    const patch: UpdatePlanInput = {}
    if (product.trim() !== initialProduct) patch.dodoProduct = product.trim()
    if (Number(priceCents) !== plan.priceCents) patch.priceCents = Number(priceCents)
    if (Number(creditsGranted) !== plan.creditsGranted) {
      patch.creditsGranted = Number(creditsGranted)
    }
    if (Number(grantDays) !== plan.grantDays) patch.grantDays = Number(grantDays)
    if (Number(grantsPerPeriod) !== plan.grantsPerPeriod) {
      patch.grantsPerPeriod = Number(grantsPerPeriod)
    }
    if (active !== plan.active) patch.active = active

    if (!Object.keys(patch).length) {
      onCancel()
      return
    }

    try {
      const saved = await update.mutate(patch)
      toast(
        saved?.configured
          ? `${plan.tier}/${plan.cycle} is attached and on sale`
          : `${plan.tier}/${plan.cycle} updated`,
      )
      onSaved()
    } catch (err) {
      // 400 (unreadable product value) and 409 (product already attached
      // elsewhere) are written for this audience — show them as-is.
      toastError(err, 'Could not update the plan')
    }
  }

  const creditsPerPeriod = Number(creditsGranted) * Number(grantsPerPeriod)

  return (
    <form className="inline-editor" onSubmit={onSubmit}>
      <div className="inline-editor-main">
        <Field
          label="Dodo product id or payment link"
          hint="Both work — the server derives the other half. Leave empty to take this plan off sale without deactivating it."
        >
          <input
            className="input"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="pdt_abc123  ·  https://checkout.dodopayments.com/buy/pdt_abc123"
            autoFocus
          />
        </Field>
      </div>

      <div className="inline-editor-grid">
        <Field label="Price (cents)" hint={formatCents(Number(priceCents))}>
          <input
            className="input"
            type="number"
            min={0}
            value={priceCents}
            onChange={(e) => setPriceCents(e.target.value)}
          />
        </Field>
        <Field label="Credits granted">
          <input
            className="input"
            type="number"
            min={0}
            value={creditsGranted}
            onChange={(e) => setCreditsGranted(e.target.value)}
          />
        </Field>
        <Field label="Grant every (days)">
          <input
            className="input"
            type="number"
            min={1}
            value={grantDays}
            onChange={(e) => setGrantDays(e.target.value)}
          />
        </Field>
        <Field
          label="Grants per period"
          hint={
            Number.isFinite(creditsPerPeriod)
              ? `${formatNumber(creditsPerPeriod)} credits per period`
              : undefined
          }
        >
          <input
            className="input"
            type="number"
            min={1}
            value={grantsPerPeriod}
            onChange={(e) => setGrantsPerPeriod(e.target.value)}
          />
        </Field>
      </div>

      <div className="inline-editor-foot">
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        <div className="spacer" />
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={update.pending}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" type="submit" disabled={update.pending}>
          {update.pending && <span className="spinner" />}
          Save plan
        </button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Credit packs                                                                */
/* -------------------------------------------------------------------------- */

function CreditPacksSection({ query }: { query: ReturnType<typeof useQuery<CreditPack[]>> }) {
  const { isSuperAdmin } = useAuth()
  const { toast, toastError } = useToast()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CreditPack | null>(null)
  const [deleting, setDeleting] = useState<CreditPack | null>(null)

  const remove = useMutation((id: string) => endpoints.deleteCreditPack(id))

  const rows = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [query.data],
  )

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutate(deleting.id)
      toast(`Deleted pack ${deleting.slug}`)
      setDeleting(null)
      query.refetch()
    } catch (err) {
      toastError(err, 'Could not delete the credit pack')
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2>Credit packs</h2>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={query.refetch} disabled={query.loading}>
          <IconRefresh />
          Refresh
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <IconPlus />
          New pack
        </button>
      </div>

      {query.error &&
        (isMissingRoute(query.error) ? (
          <MissingRouteNote what="credit pack" routes={['/v1/admin/billing/credit-packs']} />
        ) : (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ))}

      {query.initialLoading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : (
        !query.error && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Credits</th>
                  <th>Price</th>
                  <th>Order</th>
                  <th>Dodo product</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((pack) => (
                  <tr key={pack.id}>
                    <td>
                      <div className="plan-name">
                        <span className="mono">{pack.slug}</span>
                        {pack.popular && <Badge tone="violet">popular</Badge>}
                      </div>
                    </td>
                    <td className="nowrap">{formatNumber(pack.credits)}</td>
                    <td className="nowrap">
                      {formatCents(pack.priceCents)}
                      {pack.currency && pack.currency !== 'USD' && (
                        <span className="text-faint"> {pack.currency}</span>
                      )}
                    </td>
                    <td className="text-muted">{pack.sortOrder}</td>
                    <td style={{ maxWidth: 220 }}>
                      <CopyValue value={pack.dodoProductId} empty="Not attached" />
                    </td>
                    <td>
                      {!pack.active ? (
                        <Badge>Inactive</Badge>
                      ) : !pack.configured ? (
                        <Badge tone="amber">Cannot be bought</Badge>
                      ) : (
                        <div className="badge-stack">
                          <Badge tone="green">
                            <span className="dot" />
                            On sale
                          </Badge>
                          {pack.linkIsTestMode && <Badge tone="amber">test link</Badge>}
                        </div>
                      )}
                    </td>
                    <td className="actions">
                      <button
                        className="btn btn-icon"
                        onClick={() => setEditing(pack)}
                        title="Edit pack"
                      >
                        <IconEdit />
                      </button>
                      {isSuperAdmin && (
                        <button
                          className="btn btn-icon danger"
                          onClick={() => setDeleting(pack)}
                          title="Delete pack (SUPERADMIN)"
                        >
                          <IconTrash />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <EmptyState
                title="No credit packs"
                message="Create one to sell credits without a subscription."
              />
            )}
          </div>
        )
      )}

      {creating && (
        <CreditPackModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            query.refetch()
          }}
        />
      )}

      {editing && (
        <CreditPackModal
          pack={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            query.refetch()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this credit pack?"
          destructive
          confirmLabel="Delete pack"
          pending={remove.pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          message={
            <>
              Pack <strong style={{ color: 'var(--text)' }}>{deleting.slug}</strong> (
              {formatNumber(deleting.credits)} credits for {formatCents(deleting.priceCents)}) will
              be permanently deleted.
              <p style={{ marginTop: 10 }}>
                A payment already in flight carries this slug in its checkout metadata. If one
                arrives after the pack is gone, the webhook will have nothing to grant and the
                customer will be charged for nothing. Setting the pack inactive instead retires it
                safely.
              </p>
            </>
          }
        />
      )}
    </div>
  )
}

function CreditPackModal({
  pack,
  onClose,
  onDone,
}: {
  pack?: CreditPack
  onClose: () => void
  onDone: () => void
}) {
  const { toast, toastError } = useToast()
  const isEdit = !!pack

  const initialProduct = pack?.dodoLinkUrl || pack?.dodoProductId || ''

  const [slug, setSlug] = useState(pack?.slug ?? '')
  const [credits, setCredits] = useState(String(pack?.credits ?? ''))
  const [priceCents, setPriceCents] = useState(String(pack?.priceCents ?? ''))
  const [currency, setCurrency] = useState(pack?.currency ?? 'USD')
  const [popular, setPopular] = useState(pack?.popular ?? false)
  const [sortOrder, setSortOrder] = useState(String(pack?.sortOrder ?? 0))
  const [product, setProduct] = useState(initialProduct)
  const [active, setActive] = useState(pack?.active ?? true)

  const save = useMutation((input: CreateCreditPackInput | UpdateCreditPackInput) =>
    isEdit
      ? endpoints.updateCreditPack(pack.id, input as UpdateCreditPackInput)
      : endpoints.createCreditPack(input as CreateCreditPackInput),
  )

  const slugInvalid = !isEdit && slug.length > 0 && !SLUG_PATTERN.test(slug)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    const base = {
      credits: Number(credits),
      priceCents: Number(priceCents),
      currency: currency.trim().toUpperCase(),
      popular,
      sortOrder: Number(sortOrder),
      active,
    }

    try {
      if (isEdit) {
        // Only send dodoProduct when it actually changed, so saving an
        // unrelated field can't clear or re-derive the attached product.
        const patch: UpdateCreditPackInput = { ...base }
        if (product.trim() !== initialProduct) patch.dodoProduct = product.trim()
        await save.mutate(patch)
        toast(`Updated pack ${pack.slug}`)
      } else {
        await save.mutate({ ...base, slug: slug.trim(), dodoProduct: product.trim() })
        toast(`Created pack ${slug.trim()}`)
      }
      onDone()
    } catch (err) {
      toastError(err, isEdit ? 'Could not update the pack' : 'Could not create the pack')
    }
  }

  return (
    <Modal
      title={isEdit ? `Edit pack ${pack.slug}` : 'New credit pack'}
      subtitle={
        isEdit
          ? 'The slug is permanent and cannot be changed.'
          : 'A one-time purchase of credits, outside any subscription.'
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={save.pending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            form="pack-form"
            type="submit"
            disabled={save.pending || slugInvalid}
          >
            {save.pending && <span className="spinner" />}
            {isEdit ? 'Save pack' : 'Create pack'}
          </button>
        </>
      }
    >
      <form id="pack-form" onSubmit={onSubmit}>
        <Field
          label="Slug"
          hint={
            isEdit
              ? 'Permanent — it travels in checkout metadata and the webhook reads it back.'
              : 'Lowercase letters, digits, underscore and hyphen. 3–60 characters. This cannot be changed later.'
          }
          error={slugInvalid ? 'Must match ^[a-z0-9_-]{3,60}$' : undefined}
        >
          <input
            className="input mono"
            required
            readOnly={isEdit}
            disabled={isEdit}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="pack_240"
          />
        </Field>

        <div className="form-grid">
          <Field label="Credits">
            <input
              className="input"
              type="number"
              min={1}
              required
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
          </Field>
          <Field label="Price (cents)" hint={formatCents(Number(priceCents))}>
            <input
              className="input"
              type="number"
              min={0}
              required
              value={priceCents}
              onChange={(e) => setPriceCents(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <input
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="USD"
            />
          </Field>
          <Field label="Sort order" hint="Lowest first on the pricing page.">
            <input
              className="input"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Dodo product id or payment link"
          hint="Both work — the server derives the other half. Leave empty to create the pack unattached."
        >
          <input
            className="input"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="pdt_abc123  ·  https://checkout.dodopayments.com/buy/pdt_abc123"
          />
        </Field>

        <div className="check-row">
          <label className="check">
            <input
              type="checkbox"
              checked={popular}
              onChange={(e) => setPopular(e.target.checked)}
            />
            Highlight as popular
          </label>
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </div>
      </form>
    </Modal>
  )
}
