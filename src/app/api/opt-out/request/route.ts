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

// Explicit function-duration ceiling, in seconds. Vercel's Hobby tier
// defaults to 10s if this isn't set — uncomfortably close to the 8s
// internal deadline below — so this pins the assumption instead of relying
// on whatever default the deployment tier happens to have.
export const maxDuration = 30

const SUCCESS_BODY = '{"success":true}'
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const RESEND_COOLDOWN_MS = 2 * 60 * 1000
// Comfortably under the `maxDuration` above. Neither supabase-admin nor
// sendgrid takes an abort signal, so a black-hole stall on either call
// (unlike a fast connection-refused, which the catch-all below already
// handles) could otherwise hang this handler until the platform itself
// times the function out — reachable only on the matched-email path, which
// would turn that timing into exactly the oracle this route exists to
// prevent. `withDeadline` guarantees the identical success body no later
// than this many milliseconds after validation, regardless of what's
// stalled.
const REQUEST_DEADLINE_MS = 8_000

// Step 1 of the opt-out flow: the visitor submits an email; if it matches a
// record from the export, this mints a confirmation token (stored only as
// its SHA-256 digest) and emails the confirm link via SendGrid.
//
// The response is deliberately identical — `SUCCESS_BODY`, byte for byte —
// whether the email matched, missed, is on cooldown, is already confirmed,
// lost the insert race to a concurrent request, the send itself failed, or
// nothing settled before the deadline. That is the anti-enumeration
// property this route exists to protect, so nothing past the format check
// may change the status or body. For the same reason a caught error is
// never logged or echoed: its message can carry the upstream PostgREST
// request URL, which embeds the email address.
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

  const requestUrl = request.url
  const work = mintAndSend(normalized, supabaseKey, sendgridKey, requestUrl).catch(() => success())
  return withDeadline(work, REQUEST_DEADLINE_MS)
}

async function mintAndSend(
  normalized: string,
  supabaseKey: string,
  sendgridKey: string,
  requestUrl: string,
): Promise<Response> {
  const origin = new URL(requestUrl).origin
  const record = await findRecordNameByEmail(normalized, supabaseKey)
  if (!record) return success()

  const existing = await getOptOutByEmail(normalized, supabaseKey)
  if (existing?.confirmed_at) return success()
  if (isWithinCooldown(existing?.last_sent_at)) return success()

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

  const confirmUrl = new URL(dataOptOutConfirmPath(token), origin).toString()
  await sendOptOutConfirmationEmail({ to: normalized, firstName: record.name, confirmUrl }, sendgridKey)
  return success()
}

// An unparseable `last_sent_at` fails closed (treated as "just sent", so no
// resend goes out) rather than open (which would re-mint and re-send on
// every request) — the safer failure direction here is less email, not more.
function isWithinCooldown(lastSentAt: string | null | undefined): boolean {
  if (!lastSentAt) return false
  const sentAt = Date.parse(lastSentAt)
  if (Number.isNaN(sentAt)) return true
  return Date.now() - sentAt < RESEND_COOLDOWN_MS
}

// Races `work` against a fixed deadline that resolves (never rejects) to the
// same success response. The deadline's timer is always cleared in
// `finally`, so the common case — `work` settling well within budget —
// never leaves a stray timer behind.
async function withDeadline(work: Promise<Response>, ms: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<Response>((resolve) => {
    timer = setTimeout(() => resolve(success()), ms)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function success(): Response {
  return new Response(SUCCESS_BODY, { status: 200, headers: { 'content-type': 'application/json' } })
}
