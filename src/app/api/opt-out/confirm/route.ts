import { createHash } from 'node:crypto'
import { supabaseSecretKey, getOptOutByDigest, confirmOptOut } from '@/lib/supabase-admin'

// Step 2: the visitor lands on the confirmation link and this exchanges the
// token embedded in it for a definitive confirmation. The raw token is only
// ever hashed here — the digest, never the token itself, is what reaches
// Supabase or a URL.
//
// Confirmed-before-expired: a row with `confirmed_at` already set is never
// reported invalid, even past `expires_at` — a user who already opted out
// and re-clicks an old link must not be told their link failed.
//
// Idempotent and one-way: an already-confirmed row returns its ORIGINAL
// `confirmed_at` without calling `confirmOptOut` again — there is no
// un-opt-out path.
//
// Errors are never echoed: a caught error's message can carry the upstream
// PostgREST request URL, which embeds the email address.
export async function POST(request: Request): Promise<Response> {
  let token = ''
  try {
    const body = (await request.json()) as Record<string, unknown> | null
    token = typeof body?.token === 'string' ? body.token.trim() : ''
  } catch {
    token = ''
  }
  if (!token) {
    return Response.json({ error: 'token is required' }, { status: 400 })
  }

  const key = supabaseSecretKey()
  if (key === null) {
    return Response.json({ error: "Opt-out isn't configured on this deployment" }, { status: 503 })
  }

  const digest = createHash('sha256').update(token).digest('hex')

  try {
    const row = await getOptOutByDigest(digest, key)
    if (!row || (!row.confirmed_at && Date.parse(row.expires_at) < Date.now())) {
      return Response.json({ error: 'Invalid or expired link' }, { status: 422 })
    }

    const final = row.confirmed_at ? row : await confirmOptOut(row.id, key)
    return Response.json(
      { success: true, email: final.email, confirmed_at: final.confirmed_at },
      { status: 200 },
    )
  } catch {
    return Response.json({ error: 'Upstream failure' }, { status: 502 })
  }
}
