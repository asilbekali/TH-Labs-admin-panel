import { useState, type FormEvent } from 'react'
import { ApiError, endpoints, isMissingRoute } from '../lib/api'
import { useMutation } from '../lib/useApi'
import {
  MAIL_RECIPIENT_LIMIT,
  type MailRecipient,
  type SendMailInput,
  type SendMailResult,
} from '../lib/types'
import { MAIL_TEMPLATES, mailtoHref, type MailTemplate } from '../lib/mail'
import { useToast } from './Toast'
import { Field, InfoNote } from './ui'
import { IconAlert, IconExternal, IconSend } from './icons'

interface ComposeFormProps {
  recipients: MailRecipient[]
  initial?: Partial<Pick<MailTemplate, 'subject' | 'heading' | 'message'>>
  feedbackId?: number
  /** Extra controls rendered above the send button (e.g. "mark resolved"). */
  extra?: React.ReactNode
  onSent?: (result: SendMailResult) => void
  onCancel?: () => void
}

export function ComposeForm({
  recipients,
  initial,
  feedbackId,
  extra,
  onSent,
  onCancel,
}: ComposeFormProps) {
  const { toast } = useToast()
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [heading, setHeading] = useState(initial?.heading ?? '')
  const [message, setMessage] = useState(initial?.message ?? '')
  const [result, setResult] = useState<SendMailResult | null>(null)

  const send = useMutation((input: SendMailInput) => endpoints.sendMail(input))

  const tooMany = recipients.length > MAIL_RECIPIENT_LIMIT
  const canSend =
    recipients.length > 0 && !tooMany && subject.trim() !== '' && message.trim() !== ''

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = MAIL_TEMPLATES.find((x) => x.id === id)
    if (!t) return
    setSubject(t.subject)
    setHeading(t.heading ?? '')
    setMessage(t.message)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSend) return
    setResult(null)
    try {
      const res = await send.mutate({
        recipients,
        subject: subject.trim(),
        message: message.trim(),
        heading: heading.trim() || undefined,
        feedbackId,
      })
      setResult(res)
      if (res.sent > 0) {
        toast(
          res.failed.length
            ? `Sent to ${res.sent} of ${res.total} — ${res.failed.length} failed`
            : `Email sent to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}`,
          res.failed.length ? 'info' : 'success',
        )
        onSent?.(res)
      }
    } catch {
      /* rendered below from send.error */
    }
  }

  const error = send.error
  const unavailable =
    isMissingRoute(error) || (error instanceof ApiError && error.status === 503)

  return (
    <form className="compose" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Template">
          <select
            className="select"
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="" disabled>
              Start from a template…
            </option>
            {MAIL_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Headline" hint="Optional — shown big inside the email.">
          <input
            className="input"
            value={heading}
            maxLength={120}
            onChange={(e) => setHeading(e.target.value)}
            placeholder="Defaults to “Hey <name>”"
          />
        </Field>
      </div>

      <Field label="Subject">
        <input
          className="input"
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="About your dub from yesterday"
        />
      </Field>

      <Field label="Message" hint="Blank lines become paragraphs. Each person gets their own copy.">
        <textarea
          className="input"
          required
          rows={9}
          maxLength={10000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your message…"
        />
      </Field>

      {tooMany && (
        <InfoNote tone="warn" title={`Too many recipients (${recipients.length})`}>
          One send reaches at most {MAIL_RECIPIENT_LIMIT} people. Narrow the selection.
        </InfoNote>
      )}

      {error && !unavailable && (
        <div className="alert error">
          <IconAlert />
          <div className="alert-body">
            <strong>Could not send</strong>
            {error.message}
          </div>
        </div>
      )}

      {unavailable && (
        <InfoNote tone="warn" title="The API cannot send email right now">
          {isMissingRoute(error) ? (
            <>
              This API build has no <code>POST /v1/admin/mail</code> yet — deploy the API to send
              from here.
            </>
          ) : (
            error?.message
          )}{' '}
          Meanwhile you can send the same message from your own mail app.
          <div style={{ marginTop: 8 }}>
            <a className="btn btn-sm" href={mailtoHref(recipients, subject, message)}>
              <IconExternal />
              Open in mail app
            </a>
          </div>
        </InfoNote>
      )}

      {result && result.failed.length > 0 && (
        <InfoNote tone="warn" title={`${result.failed.length} could not be delivered`}>
          <ul className="fail-list">
            {result.failed.map((f) => (
              <li key={f.email}>
                <code>{f.email}</code> — {f.error}
              </li>
            ))}
          </ul>
        </InfoNote>
      )}

      {extra}

      <div className="compose-foot">
        <span className="text-faint">
          {recipients.length === 0
            ? 'No recipients yet'
            : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`}
        </span>
        <div className="spacer" />
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={send.pending}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" type="submit" disabled={!canSend || send.pending}>
          {send.pending ? <span className="spinner" /> : <IconSend />}
          {send.pending ? 'Sending…' : 'Send email'}
        </button>
      </div>
    </form>
  )
}
