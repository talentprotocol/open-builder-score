import { GITHUB_CLIENT_ID } from '@/lib/github-auth'
import { relay } from '../relay'

// The README-sanctioned stateless worker, colocated as a route handler:
// GitHub's device-flow endpoints send no CORS headers, so the browser cannot
// call them directly. Same-origin passthrough — no secrets, no state, and
// pinned to our own client id so it is not an open proxy.
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }
  if ((body as { client_id?: unknown })?.client_id !== GITHUB_CLIENT_ID) {
    return Response.json({ error: 'unauthorized_client' }, { status: 400 })
  }
  return relay('https://github.com/login/device/code', { client_id: GITHUB_CLIENT_ID })
}
