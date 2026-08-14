// Client-side helpers for the data-transfer opt-out flow. These call this
// app's own routes (src/app/api/opt-out/*), which hold the Supabase and
// SendGrid credentials server-side — the browser never sees
// SUPABASE_SECRET_KEY or SENDGRID_API_KEY — and never throw: every failure
// mode, network errors included, comes back as a tagged result the caller
// can render directly.

const REQUEST_PATH = '/api/opt-out/request'
const CONFIRM_PATH = '/api/opt-out/confirm'
const STATUS_PATH = '/api/opt-out/status'

// Pragmatic, not RFC 5322: a non-empty local part, an @, and a dot with
// something on both sides of it in the domain. Good enough to catch a typo
// before it costs a round trip — the request route runs this same check
// again server-side on submit, and that copy is the source of truth.
export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>
    return typeof body.error === 'string' ? body.error : 'Something went wrong.'
  } catch {
    return 'Something went wrong.'
  }
}

export type RequestOptOutResult =
  | { status: 'sent' }
  | { status: 'invalid'; message: string }
  | { status: 'rate-limited' }
  | { status: 'unavailable' }

export async function requestOptOut(
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RequestOptOutResult> {
  let response: Response
  try {
    response = await fetchImpl(REQUEST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch {
    return { status: 'unavailable' }
  }
  if (response.status === 200) return { status: 'sent' }
  if (response.status === 422) return { status: 'invalid', message: await readErrorMessage(response) }
  // Not dead code: this route itself never emits 429, but a Vercel Firewall
  // rate rule on /api/opt-out is a planned, mandatory rollout step, and it
  // answers with 429 for this fetch before the request reaches our handler.
  // Keep this branch so rate-limited users get the specific copy below
  // instead of the generic "unavailable" state.
  if (response.status === 429) return { status: 'rate-limited' }
  return { status: 'unavailable' }
}

export type ConfirmOptOutResult =
  | { status: 'confirmed'; email: string }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export async function confirmOptOut(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConfirmOptOutResult> {
  let response: Response
  try {
    response = await fetchImpl(CONFIRM_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch {
    return { status: 'unavailable' }
  }
  if (response.status === 422) return { status: 'invalid' }
  if (response.status !== 200) return { status: 'unavailable' }
  try {
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body.email === 'string') return { status: 'confirmed', email: body.email }
  } catch {
    // fall through
  }
  return { status: 'unavailable' }
}

export type FetchOptOutStatusResult =
  | { status: 'ready'; email: string; confirmed: boolean }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export async function fetchOptOutStatus(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchOptOutStatusResult> {
  let response: Response
  try {
    response = await fetchImpl(`${STATUS_PATH}?token=${encodeURIComponent(token)}`)
  } catch {
    return { status: 'unavailable' }
  }
  if (response.status === 422) return { status: 'invalid' }
  if (response.status !== 200) return { status: 'unavailable' }
  try {
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body.email === 'string' && typeof body.confirmed === 'boolean') {
      return { status: 'ready', email: body.email, confirmed: body.confirmed }
    }
  } catch {
    // fall through
  }
  return { status: 'unavailable' }
}
