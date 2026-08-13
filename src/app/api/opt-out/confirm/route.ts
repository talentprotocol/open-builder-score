import { talentApiKey, talentApiUrl } from '@/lib/talent-api'

const UPSTREAM_TIMEOUT_MS = 10_000

// Step 2: the visitor lands on the confirmation link and this exchanges the
// token embedded in it for a definitive confirmation.
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

  const apiKey = talentApiKey()
  if (apiKey === null) {
    return Response.json({ error: "Opt-out isn't configured on this deployment" }, { status: 503 })
  }

  let response: Response
  try {
    response = await fetch(`${talentApiUrl()}/data_transfer_opt_outs/confirm`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return Response.json({ error: 'talent-api is unreachable' }, { status: 502 })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return Response.json({ error: 'talent-api returned an unexpected response' }, { status: 502 })
  }

  return Response.json(payload, { status: response.status })
}
