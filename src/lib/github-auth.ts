// Client half of the GitHub OAuth web flow. The client ID is a public
// identifier — same precedent as the WalletConnect projectId — so it ships
// committed. The env override exists so the app can be pointed at a different
// GitHub app without a code change. The matching secret is server-side only
// (see github-oauth.ts) and never reaches this bundle.
export const GITHUB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || 'Ov23lifhhYZia6r3ZYv3'

export const AUTHORIZE_ENDPOINT = '/api/github/authorize'
export const SESSION_ENDPOINT = '/api/github/session'

// Query param the callback uses to report a failure on the page the user
// started from, since a redirect flow has nowhere else to put one.
export const ERROR_PARAM = 'github_error'

export type UserResult = { status: 'ok'; login: string } | { status: 'error'; reason: string }

export type SessionResult =
  | { status: 'ok'; token: string; login: string }
  | { status: 'none' }
  | { status: 'error'; reason: string }

// Where to send the browser to start sign-in. `returnTo` comes back as the
// landing path; the server validates it, so a crafted link can't bounce the
// user off-origin.
export function signInHref(returnTo: string): string {
  return `${AUTHORIZE_ENDPOINT}?return=${encodeURIComponent(returnTo)}`
}

// Claims the session the callback parked in a cookie. Reading it clears it,
// so this is single-use: the token's resting place is sessionStorage.
export async function claimGithubSession(fetchFn: typeof fetch = fetch): Promise<SessionResult> {
  try {
    const response = await fetchFn(SESSION_ENDPOINT, { cache: 'no-store' })
    if (!response.ok) return { status: 'error', reason: `GitHub sign-in failed (${response.status})` }
    const raw = (await response.json()) as Record<string, unknown>
    if (raw.status === 'ok' && typeof raw.token === 'string' && typeof raw.login === 'string') {
      return { status: 'ok', token: raw.token, login: raw.login }
    }
    if (raw.status === 'none') return { status: 'none' }
    return { status: 'error', reason: 'GitHub returned an unexpected shape' }
  } catch {
    return { status: 'error', reason: 'GitHub sign-in is unreachable' }
  }
}

export async function fetchAuthenticatedUser(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<UserResult> {
  try {
    const response = await fetchFn('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return { status: 'error', reason: `GitHub user lookup failed (${response.status})` }
    const raw = (await response.json()) as Record<string, unknown>
    if (typeof raw.login !== 'string') {
      return { status: 'error', reason: 'GitHub returned an unexpected shape' }
    }
    return { status: 'ok', login: raw.login }
  } catch {
    return { status: 'error', reason: 'GitHub is unreachable' }
  }
}

// Wraps fetch to authenticate api.github.com reads (5,000 req/hr). Merges
// plain-object headers only — which is all src/lib/github.ts passes.
export function authorizedFetch(token: string): typeof fetch {
  return (input, init = {}) =>
    fetch(input, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    })
}
