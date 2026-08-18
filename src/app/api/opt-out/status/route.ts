import { createHash } from 'node:crypto'
import { supabaseSecretKey, getOptOutByDigest } from '@/lib/supabase-admin'

// Lets the confirmation page show what will happen before the visitor
// commits: which email the token belongs to and whether it is already
// confirmed. Read-only — this route never calls a mutating function, so
// simply loading the page can never confirm the opt-out.
//
// The raw token is only ever hashed here — the digest, never the token
// itself, is what reaches Supabase or a URL.
//
// Confirmed-before-expired: a row with `confirmed_at` already set is never
// reported invalid, even past `expires_at` — mirrors the confirm route so
// the two never disagree about the same row.
//
// Errors are never echoed: a caught error's message can carry the upstream
// PostgREST request URL, which embeds the email address.
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token')?.trim() ?? ''
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

    return Response.json({ email: row.email, confirmed: row.confirmed_at !== null }, { status: 200 })
  } catch {
    return Response.json({ error: 'Upstream failure' }, { status: 502 })
  }
}
