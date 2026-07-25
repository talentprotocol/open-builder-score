import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

// Counterpart to the device-code passthrough. The grant type is pinned
// server-side so this cannot be used for any other OAuth exchange.
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }
  const clientId = (body as { client_id?: unknown })?.client_id
  const deviceCode = (body as { device_code?: unknown })?.device_code
  if (clientId !== GITHUB_CLIENT_ID || typeof deviceCode !== 'string') {
    return Response.json({ error: 'unauthorized_client' }, { status: 400 })
  }
  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  return Response.json(await upstream.json(), { status: upstream.status })
}
