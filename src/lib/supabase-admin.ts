// Server-only access to Supabase Postgres via PostgREST, using the service
// key. Never imported by a client component — it reads SUPABASE_SECRET_KEY.
//
// Talent Protocol is shutting down; this replaces src/lib/talent-api.ts as
// the backend for the data-transfer opt-out flow. `records` / `extra_emails`
// hold a one-time export of registered users (the lookup the opt-out request
// route matches an email against); `opt_outs` is this flow's own state
// machine (token digest, expiry, confirmation). RLS is enabled with no
// policies on all three tables, so only this service key — held server-side
// in Vercel — can read or write; the anon/authenticated Supabase roles see
// nothing.
//
// Emails are always passed in already normalized (lowercase, trimmed) by the
// caller — normalization happens once, in the route — so lookups here use
// plain `eq.` filters rather than `ilike`.

export function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL
  return typeof url === 'string' && url !== '' ? url : 'https://faejimtdyfbawvdnvaly.supabase.co'
}

export function supabaseSecretKey(): string | null {
  const key = process.env.SUPABASE_SECRET_KEY
  return typeof key === 'string' && key !== '' ? key : null
}

export type OptOutRow = {
  id: number
  email: string
  token_digest: string
  expires_at: string
  confirmed_at: string | null
  last_sent_at: string | null
}

interface PgInit {
  method: 'GET' | 'POST' | 'PATCH'
  body?: string
  headers?: Record<string, string>
}

async function pg(
  path: string,
  init: PgInit,
  key: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(`${supabaseUrl()}/rest/v1${path}`, {
    method: init.method,
    body: init.body,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function pgRows<T>(
  path: string,
  key: string,
  fetchImpl: typeof fetch,
  what: string,
): Promise<T[]> {
  const response = await pg(path, { method: 'GET' }, key, fetchImpl)
  if (!response.ok) throw new Error(`Supabase ${what} lookup failed (${response.status})`)
  return (await response.json()) as T[]
}

// Checks `records.email` first, then falls through to `extra_emails.email`
// (a verified secondary email, joined back to its owning record). `null`
// means no match in either table; a match with no name on file still comes
// back as `{ name: null }`.
export async function findRecordNameByEmail(
  email: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ name: string | null } | null> {
  const encoded = encodeURIComponent(email)

  const records = await pgRows<{ name: string | null }>(
    `/records?email=eq.${encoded}&select=name`,
    key,
    fetchImpl,
    'records',
  )
  if (records.length > 0) return { name: records[0].name }

  const extras = await pgRows<{ record_id: number; records: { name: string | null } | null }>(
    `/extra_emails?email=eq.${encoded}&select=record_id,records(name)`,
    key,
    fetchImpl,
    'extra_emails',
  )
  if (extras.length > 0) return { name: extras[0].records?.name ?? null }

  return null
}

export async function getOptOutByEmail(
  email: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OptOutRow | null> {
  const rows = await pgRows<OptOutRow>(
    `/opt_outs?email=eq.${encodeURIComponent(email)}`,
    key,
    fetchImpl,
    'opt_outs',
  )
  return rows[0] ?? null
}

export async function getOptOutByDigest(
  digest: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OptOutRow | null> {
  const rows = await pgRows<OptOutRow>(
    `/opt_outs?token_digest=eq.${encodeURIComponent(digest)}`,
    key,
    fetchImpl,
    'opt_outs',
  )
  return rows[0] ?? null
}

// The `opt_outs.email` unique constraint is the anti-duplicate guard: a
// second, concurrent insert for the same email comes back as PostgREST 409.
// The caller (the request route) treats that as a double-submit race — the
// other request already owns the row and will send its own confirmation
// email — and responds with success without inserting, updating, or sending
// again.
export async function insertOptOut(
  fields: { email: string; token_digest: string; expires_at: string; last_sent_at: string },
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'inserted' | 'conflict'> {
  const response = await pg('/opt_outs', { method: 'POST', body: JSON.stringify(fields) }, key, fetchImpl)
  if (response.status === 409) return 'conflict'
  if (!response.ok) throw new Error(`Supabase opt_outs insert failed (${response.status})`)
  return 'inserted'
}

export async function updateOptOut(
  id: number,
  fields: Partial<Pick<OptOutRow, 'token_digest' | 'expires_at' | 'last_sent_at'>>,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await pg(
    `/opt_outs?id=eq.${id}`,
    { method: 'PATCH', body: JSON.stringify(fields) },
    key,
    fetchImpl,
  )
  if (!response.ok) throw new Error(`Supabase opt_outs update failed (${response.status})`)
}

// Idempotent and one-way: the filter only matches a row that isn't confirmed
// yet, so a second call never overwrites the original confirmed_at. If two
// requests race, the loser's PATCH matches zero rows (not an error — the
// row got confirmed a moment ago) and it re-reads the row the winner wrote.
export async function confirmOptOut(
  id: number,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OptOutRow> {
  const response = await pg(
    `/opt_outs?id=eq.${id}&confirmed_at=is.null`,
    {
      method: 'PATCH',
      body: JSON.stringify({ confirmed_at: new Date().toISOString() }),
      headers: { Prefer: 'return=representation' },
    },
    key,
    fetchImpl,
  )
  if (!response.ok) throw new Error(`Supabase opt_outs confirm failed (${response.status})`)
  const rows = (await response.json()) as OptOutRow[]
  if (rows.length > 0) return rows[0]

  const reread = await pgRows<OptOutRow>(`/opt_outs?id=eq.${id}`, key, fetchImpl, 'opt_outs')
  if (reread.length === 0) throw new Error(`Supabase opt_outs row ${id} not found after confirm`)
  return reread[0]
}
