import {
  expireCookie,
  isSecureRequest,
  readCookie,
  SESSION_COOKIE,
  unpackSession,
} from '@/lib/github-oauth'

// Step 3: the client claims the parked session exactly once. Clearing the
// cookie on read keeps the token's resting place sessionStorage — per tab,
// gone on close — which is the same blast radius the device flow had.
export async function GET(request: Request): Promise<Response> {
  const session = unpackSession(readCookie(request.headers.get('cookie'), SESSION_COOKIE))
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', expireCookie(SESSION_COOKIE, isSecureRequest(request)))
  return Response.json(session ? { status: 'ok', ...session } : { status: 'none' }, { headers })
}
