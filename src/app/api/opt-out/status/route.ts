import { talentApiKey, talentApiUrl } from '@/lib/talent-api'

const UPSTREAM_TIMEOUT_MS = 10_000

// Lets the confirmation page show what will happen before the visitor
// commits: which email the token belongs to and whether it is already
// confirmed.
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token')?.trim() ?? ''
  if (!token) {
    return Response.json({ error: 'token is required' }, { status: 400 })
  }

  const apiKey = talentApiKey()
  if (apiKey === null) {
    return Response.json({ error: "Opt-out isn't configured on this deployment" }, { status: 503 })
  }

  let response: Response
  try {
    response = await fetch(
      `${talentApiUrl()}/data_transfer_opt_outs/status?token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
        headers: { 'X-API-KEY': apiKey },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    )
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
