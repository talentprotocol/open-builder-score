// Server-only half of the GitHub OAuth web flow. Never imported by a client
// component — it reads GITHUB_CLIENT_SECRET.
//
// Why this and not the device flow it replaced: the device flow needs no
// secret, but it asks a browser user to copy a code into a second tab, which
// is a TV/CLI affordance rather than a web one. The redirect flow is two
// clicks in one tab. GitHub does not support PKCE, so there is no secretless
// version of it — the secret is the price of the better flow. It stays a
// server-side env var: never committed, never in the client bundle, and
// scoring still works fully signed-out, so a deployment without it degrades
// to "sign-in unavailable" rather than breaking.

import { GITHUB_CLIENT_ID } from './github-auth'

export const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const CALLBACK_PATH = '/api/github/callback'

export const STATE_COOKIE = 'obs_gh_state'
export const SESSION_COOKIE = 'obs_gh_session'

// The state cookie only has to outlive one trip to github.com; the session
// cookie only has to survive the redirect back, since the client claims it
// immediately and hands it to sessionStorage.
const STATE_MAX_AGE = 600
const SESSION_MAX_AGE = 120
const UPSTREAM_TIMEOUT_MS = 10_000

export function githubClientSecret(): string | null {
  const secret = process.env.GITHUB_CLIENT_SECRET
  return typeof secret === 'string' && secret !== '' ? secret : null
}

// Open-redirect guard: only same-origin absolute paths come back out. `//evil`
// and `/\evil` are protocol-relative URLs that browsers navigate off-origin,
// so requiring a leading `/` is not on its own enough.
export function safeReturnPath(raw: string | null): string {
  const fallback = '/score'
  if (!raw || !raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}

export function randomState(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', GITHUB_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  // No `scope`: the token exists to identify the user and lift the API rate
  // limit, and it should be able to do nothing else.
  return url.toString()
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAge, secure }: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: the cookie has to survive a top-level navigation back
    // from github.com, which Strict would drop.
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function expireCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAge: 0, secure })
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.split('=')
    if (rawKey.trim() !== name) continue
    try {
      return decodeURIComponent(rest.join('='))
    } catch {
      return null
    }
  }
  return null
}

// state and return path travel together in one cookie so a tampered `state`
// can't be paired with an attacker-chosen landing page.
export function packState(state: string, returnPath: string): string {
  return JSON.stringify({ state, returnPath })
}

export function unpackState(raw: string | null): { state: string; returnPath: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.state !== 'string' || typeof parsed.returnPath !== 'string') return null
    return { state: parsed.state, returnPath: safeReturnPath(parsed.returnPath) }
  } catch {
    return null
  }
}

export interface GithubSession {
  token: string
  login: string
}

export function packSession(session: GithubSession): string {
  return JSON.stringify(session)
}

export function unpackSession(raw: string | null): GithubSession | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.token !== 'string' || typeof parsed.login !== 'string') return null
    return { token: parsed.token, login: parsed.login }
  } catch {
    return null
  }
}

export const STATE_COOKIE_OPTIONS = { maxAge: STATE_MAX_AGE }
export const SESSION_COOKIE_OPTIONS = { maxAge: SESSION_MAX_AGE }

export type ExchangeResult =
  | { status: 'ok'; token: string }
  | { status: 'error'; reason: string }

// GitHub answers a rejected exchange with HTTP 200 and an error body, and
// answers rate limiting with HTML, so neither the status nor the parse can be
// trusted on its own.
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientSecret: string,
  fetchFn: typeof fetch = fetch,
): Promise<ExchangeResult> {
  let response: Response
  try {
    response = await fetchFn(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return { status: 'error', reason: 'GitHub is unreachable or timed out.' }
  }
  let raw: Record<string, unknown> | null
  try {
    raw = (await response.json()) as Record<string, unknown>
  } catch {
    return { status: 'error', reason: `GitHub returned a non-JSON response (${response.status}).` }
  }
  if (typeof raw.access_token === 'string') return { status: 'ok', token: raw.access_token }
  if (typeof raw.error_description === 'string') {
    return { status: 'error', reason: raw.error_description }
  }
  if (typeof raw.error === 'string') return { status: 'error', reason: `GitHub said: ${raw.error}` }
  return { status: 'error', reason: 'GitHub returned an unexpected shape.' }
}

// Behind a proxy the request URL is http even when the browser spoke https,
// so the forwarded header decides whether the cookies get Secure.
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0].trim() === 'https'
  return new URL(request.url).protocol === 'https:'
}

export function originOf(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? url.host
  const proto = isSecureRequest(request) ? 'https' : url.protocol.replace(':', '')
  return `${proto}://${host}`
}
