import type { MailRecipient } from './types'

export interface MailTemplate {
  id: string
  label: string
  subject: string
  heading?: string
  message: string
}

/**
 * Starting points, not policy. `{name}` is left for the reader — the API's
 * own greeting already says hello to each recipient by name.
 */
export const MAIL_TEMPLATES: MailTemplate[] = [
  { id: 'blank', label: 'Blank', subject: '', message: '' },
  {
    id: 'feedback',
    label: 'Thanks for your feedback',
    subject: 'Thanks for your feedback',
    heading: 'We read every message',
    message:
      'Thank you for taking the time to write to us.\n\n' +
      'We have looked into what you reported and will keep you posted as soon as there is news.\n\n' +
      '— The TH-Labs team',
  },
  {
    id: 'fixed',
    label: 'Issue fixed',
    subject: 'Good news — it is fixed',
    heading: 'It is fixed',
    message:
      'The problem you told us about has been fixed and the update is live.\n\n' +
      'Give it another try, and just reply if anything still looks off.\n\n' +
      '— The TH-Labs team',
  },
  {
    id: 'feature',
    label: 'New feature',
    subject: 'Something new in TH-Labs Studio',
    heading: 'New in the Studio',
    message:
      'We just shipped something we think you will like.\n\n' +
      'Open the Studio to try it out — and tell us what you think.\n\n' +
      '— The TH-Labs team',
  },
  {
    id: 'maintenance',
    label: 'Maintenance notice',
    subject: 'Scheduled maintenance',
    heading: 'Short maintenance window',
    message:
      'We will be doing scheduled maintenance shortly. The Studio may be unavailable for a few minutes.\n\n' +
      'Your projects and credits are safe. Thanks for your patience.\n\n' +
      '— The TH-Labs team',
  },
]

/**
 * A `mailto:` link for the same message — the way out when the API cannot
 * send (an older build without the route, or no SMTP credentials). Several
 * recipients go in BCC so nobody sees anyone else's address.
 */
export function mailtoHref(recipients: MailRecipient[], subject: string, message: string) {
  const emails = recipients.map((r) => r.email)
  const params = new URLSearchParams()
  if (emails.length > 1) params.set('bcc', emails.join(','))
  if (subject) params.set('subject', subject)
  if (message) params.set('body', message)
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  const query = params.toString().replace(/\+/g, '%20')
  return `mailto:${emails.length === 1 ? encodeURI(emails[0]) : ''}${query ? `?${query}` : ''}`
}
