import { fetchAuthenticatedUser } from '@/lib/github-auth'
import {
  CALLBACK_PATH,
  exchangeCodeForToken,
  expireCookie,
  githubClientSecret,
  isSecureRequest,
  originOf,
  packSession,
  readCookie,
  serializeCookie,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  STATE_COOKIE,
  unpackState,
} from '@/lib/github-oauth'

function back(
  request: Request,
  returnPath: string,
  cookies: string[],
  error?: string,
): Response {
  const url = new URL(`${originOf(request)}${returnPath}`)
  if (error) url.searchParams.set('github_error', error)
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

// Step 2: GitHub sends the user back here with a code. Exchange it server-side
// (this is the only place the secret is used), then park the token in a
// short-lived HttpOnly cookie for the client to claim. The token has to reach
// the browser because scoring reads api.github.com from there — that is what
// lifts the rate limit from 60 to 5,000 req/hr.
export async function GET(request: Request): Promise<Response> {
  const secure = isSecureRequest(request)
  const params = new URL(request.url).searchParams
  const stored = unpackState(readCookie(request.headers.get('cookie'), STATE_COOKIE))
  const returnPath = stored?.returnPath ?? '/score'
  const dropState = expireCookie(STATE_COOKIE, secure)

  // GitHub reports a refused authorization here, not at the token exchange.
  const denied = params.get('error_description') ?? params.get('error')
  if (denied) return back(request, returnPath, [dropState], denied)

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state || !stored || state !== stored.state) {
    return back(request, returnPath, [dropState], 'Sign-in didn’t complete — try again.')
  }

  const secret = githubClientSecret()
  if (secret === null) {
    return back(request, returnPath, [dropState], 'GitHub sign-in isn’t configured on this deployment.')
  }

  const exchanged = await exchangeCodeForToken(
    code,
    `${originOf(request)}${CALLBACK_PATH}`,
    secret,
  )
  if (exchanged.status === 'error') {
    return back(request, returnPath, [dropState], exchanged.reason)
  }

  const user = await fetchAuthenticatedUser(exchanged.token)
  if (user.status === 'error') {
    return back(request, returnPath, [dropState], user.reason)
  }

  const session = serializeCookie(
    SESSION_COOKIE,
    packSession({ token: exchanged.token, login: user.login }),
    { ...SESSION_COOKIE_OPTIONS, secure },
  )
  return back(request, returnPath, [dropState, session])
}
