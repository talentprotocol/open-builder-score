// Server-only SendGrid v3 HTTP API client. Never imported by a client
// component — it reads SENDGRID_API_KEY. Sends the data-transfer opt-out
// confirmation email; the request route (Task 3) calls
// `sendOptOutConfirmationEmail` after minting a token.
//
// Plain fetch against SendGrid's HTTP API rather than the @sendgrid/mail
// SDK — one call doesn't earn a new dependency.
//
// This is a shutdown consent email sent to real users: the copy stays
// plain and factual, no marketing tone, and never names the company
// continuing the service.

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send'
const FROM_EMAIL = 'no-reply@talentprotocol.com'
const FROM_NAME = 'Talent Protocol'
const SUBJECT = 'Confirm your data-transfer opt-out'

export function sendgridApiKey(): string | null {
  const key = process.env.SENDGRID_API_KEY
  return typeof key === 'string' && key !== '' ? key : null
}

// SendGrid requires text/plain to precede text/html in the `content` array
// when both are present — order the entries that way, not alphabetically or
// by preference.
export async function sendOptOutConfirmationEmail(
  params: { to: string; firstName: string | null; confirmUrl: string },
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { to, firstName, confirmUrl } = params
  const greeting = `Hi ${firstName ?? 'there'},`

  const text = [
    greeting,
    '',
    `You asked to opt ${to} out of the Talent Protocol data transfer. Click the link below to confirm — the link works for 30 days.`,
    '',
    confirmUrl,
    '',
    "If you didn't request this, you can ignore this email and no changes will be made.",
  ].join('\n')

  const html = [
    `<p>${greeting}</p>`,
    `<p>You asked to opt <b>${to}</b> out of the Talent Protocol data transfer. Click the button below to confirm — the link works for 30 days.</p>`,
    `<p><a href="${confirmUrl}">Confirm opt-out</a></p>`,
    "<p>If you didn't request this, you can ignore this email and no changes will be made.</p>",
  ].join('')

  const response = await fetchImpl(SENDGRID_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: SUBJECT,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  })

  if (response.status !== 202) throw new Error('sendgrid_send_failed')
}
