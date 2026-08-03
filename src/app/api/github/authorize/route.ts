import {
  buildAuthorizeUrl,
  CALLBACK_PATH,
  githubClientSecret,
  isSecureRequest,
  originOf,
  packState,
  randomState,
  safeReturnPath,
  serializeCookie,
  STATE_COOKIE,
  STATE_COOKIE_OPTIONS,
} from '@/lib/github-oauth'

// Step 1 of the web flow: mint a CSRF state, remember where to land, and hand
// the browser to GitHub. A GET because it is reached by a plain link — the
// user is navigating, not submitting.
export async function GET(request: Request): Promise<Response> {
  const secure = isSecureRequest(request)
  const returnPath = safeReturnPath(new URL(request.url).searchParams.get('return'))

  // Nothing is configured on this deployment; say so on the page the user came
  // from rather than dumping them on an error route.
  if (githubClientSecret() === null) {
    return Response.redirect(
      `${originOf(request)}${returnPath}${returnPath.includes('?') ? '&' : '?'}github_error=${encodeURIComponent('GitHub sign-in isn’t configured on this deployment.')}`,
      302,
    )
  }

  const state = randomState()
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildAuthorizeUrl(`${originOf(request)}${CALLBACK_PATH}`, state),
      'Set-Cookie': serializeCookie(STATE_COOKIE, packState(state, returnPath), {
        ...STATE_COOKIE_OPTIONS,
        secure,
      }),
      'Cache-Control': 'no-store',
    },
  })
}
