import { describe, it, expect } from 'vitest'
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  expireCookie,
  packSession,
  packState,
  readCookie,
  safeReturnPath,
  serializeCookie,
  unpackSession,
  unpackState,
  isSecureRequest,
  originOf,
  randomState,
} from '@/lib/github-oauth'
import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('safeReturnPath', () => {
  it('keeps same-origin absolute paths', () => {
    expect(safeReturnPath('/score?wallet=0x1')).toBe('/score?wallet=0x1')
  })

  // A leading slash alone is not enough: browsers treat these as
  // protocol-relative URLs and navigate off-origin.
  it('refuses protocol-relative and off-origin targets', () => {
    for (const hostile of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil', '']) {
      expect(safeReturnPath(hostile), hostile).toBe('/score')
    }
    expect(safeReturnPath(null)).toBe('/score')
  })
})

describe('buildAuthorizeUrl', () => {
  it('pins the client id and asks for no scopes', () => {
    const url = new URL(buildAuthorizeUrl('https://x.test/api/github/callback', 'abc123'))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe(GITHUB_CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.test/api/github/callback')
    expect(url.searchParams.get('state')).toBe('abc123')
    // A scoped token could act on the user's behalf; this one only identifies
    // them and lifts the rate limit.
    expect(url.searchParams.get('scope')).toBeNull()
  })
})

describe('randomState', () => {
  it('is long and does not repeat', () => {
    const a = randomState()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(randomState())
  })
})

describe('cookies', () => {
  it('is HttpOnly and SameSite=Lax, and Secure only over https', () => {
    const secure = serializeCookie('n', 'v', { maxAge: 60, secure: true })
    expect(secure).toContain('HttpOnly')
    // Strict would drop the cookie on the way back from github.com.
    expect(secure).toContain('SameSite=Lax')
    expect(secure).toContain('Secure')
    expect(serializeCookie('n', 'v', { maxAge: 60, secure: false })).not.toContain('Secure')
  })

  it('expires with Max-Age=0', () => {
    expect(expireCookie('n', false)).toContain('Max-Age=0')
  })

  it('round-trips values that need encoding', () => {
    const header = serializeCookie('obs_gh_state', '{"a":"b c"}', { maxAge: 60, secure: false })
    const raw = header.split(';')[0]
    expect(readCookie(raw, 'obs_gh_state')).toBe('{"a":"b c"}')
  })

  it('picks the right cookie out of a crowd and tolerates junk', () => {
    expect(readCookie('a=1; obs_gh_state=x; b=2', 'obs_gh_state')).toBe('x')
    expect(readCookie('a=1', 'obs_gh_state')).toBeNull()
    expect(readCookie(null, 'obs_gh_state')).toBeNull()
    expect(readCookie('obs_gh_state=%E0%A4%A', 'obs_gh_state')).toBeNull()
  })
})

describe('state packing', () => {
  it('round-trips state with its return path', () => {
    expect(unpackState(packState('s1', '/score?a=1'))).toEqual({
      state: 's1',
      returnPath: '/score?a=1',
    })
  })

  // The pair travels together so a tampered state can't be combined with an
  // attacker-chosen landing page.
  it('re-validates the return path on the way out', () => {
    expect(unpackState(JSON.stringify({ state: 's', returnPath: '//evil.com' }))?.returnPath).toBe(
      '/score',
    )
  })

  it('is null on junk', () => {
    expect(unpackState('not json')).toBeNull()
    expect(unpackState(JSON.stringify({ state: 1 }))).toBeNull()
    expect(unpackState(null)).toBeNull()
  })
})

describe('session packing', () => {
  it('round-trips and rejects junk', () => {
    expect(unpackSession(packSession({ token: 't', login: 'octocat' }))).toEqual({
      token: 't',
      login: 'octocat',
    })
    expect(unpackSession(JSON.stringify({ token: 't' }))).toBeNull()
    expect(unpackSession('{')).toBeNull()
  })
})

describe('exchangeCodeForToken', () => {
  it('sends the secret and the code, and returns the token', async () => {
    let body: Record<string, unknown> | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://github.com/login/oauth/access_token')
      body = JSON.parse(String(init?.body))
      return jsonResponse({ access_token: 'tok123' })
    }) as typeof fetch
    expect(await exchangeCodeForToken('c1', 'https://x.test/cb', 'sekret', fakeFetch)).toEqual({
      status: 'ok',
      token: 'tok123',
    })
    expect(body!.client_secret).toBe('sekret')
    expect(body!.code).toBe('c1')
    expect(body!.redirect_uri).toBe('https://x.test/cb')
    expect(body!.client_id).toBe(GITHUB_CLIENT_ID)
  })

  // GitHub reports a refused exchange with HTTP 200 and an error body, so the
  // status alone would read as success.
  it('surfaces a 200-with-error body', async () => {
    const refused = (async () =>
      jsonResponse({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      })) as typeof fetch
    expect(await exchangeCodeForToken('c', 'u', 's', refused)).toEqual({
      status: 'error',
      reason: 'The code passed is incorrect or expired.',
    })
  })

  it('does not throw on an HTML rate-limit page', async () => {
    const html = (async () => new Response('<html>slow down</html>', { status: 429 })) as typeof fetch
    expect(await exchangeCodeForToken('c', 'u', 's', html)).toEqual({
      status: 'error',
      reason: 'GitHub returned a non-JSON response (429).',
    })
  })

  it('does not throw when GitHub is unreachable', async () => {
    const dead = (async () => {
      throw new Error('ETIMEDOUT')
    }) as typeof fetch
    expect((await exchangeCodeForToken('c', 'u', 's', dead)).status).toBe('error')
  })
})

describe('request origin', () => {
  it('trusts the forwarded proto and host behind a proxy', () => {
    const request = new Request('http://internal/api/github/callback', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'obs.example.com' },
    })
    expect(isSecureRequest(request)).toBe(true)
    expect(originOf(request)).toBe('https://obs.example.com')
  })

  it('falls back to the request URL locally', () => {
    const request = new Request('http://localhost:3000/api/github/callback')
    expect(isSecureRequest(request)).toBe(false)
    expect(originOf(request)).toBe('http://localhost:3000')
  })
})
