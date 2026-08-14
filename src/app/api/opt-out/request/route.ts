import { createHash, randomBytes } from 'node:crypto'
import { isLikelyEmail } from '@/lib/opt-out'
import {
  supabaseSecretKey,
  findRecordNameByEmail,
  getOptOutByEmail,
  insertOptOut,
  updateOptOut,
} from '@/lib/supabase-admin'
import { sendgridApiKey, sendOptOutConfirmationEmail } from '@/lib/sendgrid'
import { dataOptOutConfirmPath } from '@/lib/routes'

const SUCCESS_BODY = '{"success":true}'
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const RESEND_COOLDOWN_MS = 2 * 60 * 1000

// Step 1 of the opt-out flow: the visitor submits an email; if it matches a
// record from the export, this mints a confirmation token (stored only as
// its SHA-256 digest) and emails the confirm link via SendGrid.
//
// The response is deliberately identical — `SUCCESS_BODY`, byte for byte —
// whether the email matched, missed, is on cooldown, is already confirmed,
// lost the insert race to a concurrent request, or the send itself failed.
// That is the anti-enumeration property this route exists to protect, so
// nothing past the format check may change the status or body. For the same
// reason a caught error is never logged or echoed: its message can carry the
// upstream PostgREST request URL, which embeds the email address.
export async function POST(request: Request): Promise<Response> {
  let email: unknown
  try {
    const body = (await request.json()) as Record<string, unknown> | null
    email = body?.email
  } catch {
    return Response.json({ error: 'email is required' }, { status: 400 })
  }
  if (typeof email !== 'string' || email.trim() === '') {
    return Response.json({ error: 'email is required' }, { status: 400 })
  }

  const supabaseKey = supabaseSecretKey()
  const sendgridKey = sendgridApiKey()
  if (supabaseKey === null || sendgridKey === null) {
    return Response.json({ error: "Opt-out isn't configured on this deployment" }, { status: 503 })
  }

  const normalized = email.trim().toLowerCase()
  if (!isLikelyEmail(normalized)) {
    return Response.json({ error: 'Invalid email format' }, { status: 422 })
  }

  try {
    const record = await findRecordNameByEmail(normalized, supabaseKey)
    if (!record) return success()

    const existing = await getOptOutByEmail(normalized, supabaseKey)
    if (existing?.confirmed_at) return success()
    if (existing?.last_sent_at && Date.now() - Date.parse(existing.last_sent_at) < RESEND_COOLDOWN_MS) {
      return success()
    }

    const token = randomBytes(32).toString('hex')
    const fields = {
      token_digest: createHash('sha256').update(token).digest('hex'),
      expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      last_sent_at: new Date().toISOString(),
    }

    if (existing) {
      await updateOptOut(existing.id, fields, supabaseKey)
    } else if ((await insertOptOut({ email: normalized, ...fields }, supabaseKey)) === 'conflict') {
      // Double-submit race: another request already owns this email's row
      // and will send its own confirmation email.
      return success()
    }

    const confirmUrl = new URL(dataOptOutConfirmPath(token), new URL(request.url).origin).toString()
    await sendOptOutConfirmationEmail({ to: normalized, firstName: record.name, confirmUrl }, sendgridKey)
    return success()
  } catch {
    return success()
  }
}

function success(): Response {
  return new Response(SUCCESS_BODY, { status: 200, headers: { 'content-type': 'application/json' } })
}
