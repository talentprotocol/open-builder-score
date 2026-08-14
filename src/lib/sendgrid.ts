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

// `firstName` originates from `records.name` — free text exported from a
// legacy DB, not something this app controls the shape of — and `to` /
// `confirmUrl` are interpolated into markup too. Any of `& < > " '` in there
// would otherwise produce malformed HTML, in the worst case breaking the
// `<a href>` confirm link this email exists to deliver. `&` must be escaped
// first so the escape sequences of the later replacements don't themselves
// get re-escaped.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
  const greetName = firstName ?? 'there'

  // Plain text has no markup semantics, so this branch stays raw — escaping
  // it would show users literal `&amp;` sequences instead of their own name.
  const text = [
    `Hi ${greetName},`,
    '',
    `You asked to opt ${to} out of the Talent Protocol data transfer. Click the link below to confirm — the link works for 30 days.`,
    '',
    confirmUrl,
    '',
    "If you didn't request this, you can ignore this email and no changes will be made.",
  ].join('\n')

  const html = [
    `<p>Hi ${escapeHtml(greetName)},</p>`,
    `<p>You asked to opt <b>${escapeHtml(to)}</b> out of the Talent Protocol data transfer. Click the button below to confirm — the link works for 30 days.</p>`,
    `<p><a href="${escapeHtml(confirmUrl)}">Confirm opt-out</a></p>`,
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
