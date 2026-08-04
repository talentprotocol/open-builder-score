import { describe, it, expect, vi, afterEach } from 'vitest'
import { GET as authorizeGet } from '@/app/api/github/authorize/route'
import { GET as callbackGet } from '@/app/api/github/callback/route'
import { GET as sessionGet } from '@/app/api/github/session/route'
import { packSession, packState, readCookie, SESSION_COOKIE, STATE_COOKIE } from '@/lib/github-oauth'
import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function get(url: string, cookie?: string): Request {
  return new Request(url, { headers: cookie ? { cookie } : {} })
}

// Set-Cookie can appear more than once on a response; getSetCookie keeps them
// separate where a plain get() would join them into one unusable string.
function setCookies(response: Response): string[] {
  return response.headers.getSetCookie()
}

function cookieNamed(response: Response, name: string): string | undefined {
  return setCookies(response).find((c) => c.startsWith(`${name}=`))
}

describe('authorize route', () => {
  it('redirects to GitHub and remembers state + return path', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    const response = await authorizeGet(
      get('http://localhost:3000/api/github/authorize?return=%2Fscore%3Fwallet%3D0x1'),
    )
    expect(response.status).toBe(302)

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe(GITHUB_CLIENT_ID)
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/github/callback',
    )

    const stateCookie = cookieNamed(response, STATE_COOKIE)!
    const stored = JSON.parse(readCookie(stateCookie.split(';')[0], STATE_COOKIE)!)
    // The state in the cookie must be the one GitHub is asked to echo back.
    expect(stored.state).toBe(location.searchParams.get('state'))
    expect(stored.returnPath).toBe('/score?wallet=0x1')
    expect(stateCookie).toContain('HttpOnly')
    expect(stateCookie).not.toContain('Secure') // plain http locally
  })

  it('marks cookies Secure behind an https proxy', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    const response = await authorizeGet(
      new Request('http://internal/api/github/authorize', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'obs.example.com' },
      }),
    )
    expect(cookieNamed(response, STATE_COOKIE)).toContain('Secure')
    expect(response.headers.get('location')).toContain(
      encodeURIComponent('https://obs.example.com/api/github/callback'),
    )
  })

  it('refuses to bounce the user off-origin after sign-in', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    const response = await authorizeGet(
      get('http://localhost:3000/api/github/authorize?return=%2F%2Fevil.com'),
    )
    const stored = JSON.parse(
      readCookie(cookieNamed(response, STATE_COOKIE)!.split(';')[0], STATE_COOKIE)!,
    )
    expect(stored.returnPath).toBe('/score')
  })

  it('says so on the page the user came from when no secret is configured', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '')
    const response = await authorizeGet(get('http://localhost:3000/api/github/authorize'))
    expect(response.status).toBe(302)
    const location = response.headers.get('location')!
    expect(location).toContain('/score')
    expect(location).toContain('github_error')
    expect(location).not.toContain('github.com')
  })
})

describe('callback route', () => {
  const state = 'abc123'
  const stateCookie = `${STATE_COOKIE}=${encodeURIComponent(packState(state, '/score?wallet=0x1'))}`

  function stubGithub(tokenBody: unknown, userBody: unknown = { login: 'octocat' }) {
    vi.stubGlobal(
      'fetch',
      (async (url: unknown) =>
        String(url).includes('access_token')
          ? new Response(JSON.stringify(tokenBody), { status: 200 })
          : new Response(JSON.stringify(userBody), { status: 200 })) as typeof fetch,
    )
  }

  it('exchanges the code and parks the session for the client to claim', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    stubGithub({ access_token: 'tok123' })
    const response = await callbackGet(
      get(`http://localhost:3000/api/github/callback?code=c1&state=${state}`, stateCookie),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:3000/score?wallet=0x1')

    const session = cookieNamed(response, SESSION_COOKIE)!
    expect(JSON.parse(readCookie(session.split(';')[0], SESSION_COOKIE)!)).toEqual({
      token: 'tok123',
      login: 'octocat',
    })
    expect(session).toContain('HttpOnly')
    // The one-shot state cookie is spent either way.
    expect(cookieNamed(response, STATE_COOKIE)).toContain('Max-Age=0')
  })

  // Without this a third party could hand someone a callback URL and complete
  // a sign-in they never started.
  it('rejects a state that does not match the cookie', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await callbackGet(
      get('http://localhost:3000/api/github/callback?code=c1&state=forged', stateCookie),
    )
    expect(response.headers.get('location')).toContain('github_error')
    expect(cookieNamed(response, SESSION_COOKIE)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects a callback with no state cookie at all', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await callbackGet(
      get(`http://localhost:3000/api/github/callback?code=c1&state=${state}`),
    )
    expect(response.headers.get('location')).toContain('github_error')
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports a refused authorization on the return page', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    const response = await callbackGet(
      get(
        'http://localhost:3000/api/github/callback?error=access_denied&error_description=The+user+denied+it',
        stateCookie,
      ),
    )
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/score')
    expect(location.searchParams.get('github_error')).toBe('The user denied it')
    expect(cookieNamed(response, SESSION_COOKIE)).toBeUndefined()
  })

  it('reports a failed exchange rather than parking a session', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'sekret')
    stubGithub({ error: 'bad_verification_code', error_description: 'Code expired.' })
    const response = await callbackGet(
      get(`http://localhost:3000/api/github/callback?code=c1&state=${state}`, stateCookie),
    )
    expect(new URL(response.headers.get('location')!).searchParams.get('github_error')).toBe(
      'Code expired.',
    )
    expect(cookieNamed(response, SESSION_COOKIE)).toBeUndefined()
  })
})

describe('session route', () => {
  it('hands over the session once and spends the cookie', async () => {
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(packSession({ token: 't', login: 'octocat' }))}`
    const response = await sessionGet(get('http://localhost:3000/api/github/session', cookie))
    expect(await response.json()).toEqual({ status: 'ok', token: 't', login: 'octocat' })
    // Cleared on read, so the token's resting place stays sessionStorage.
    expect(cookieNamed(response, SESSION_COOKIE)).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('reports none when there is nothing parked', async () => {
    const response = await sessionGet(get('http://localhost:3000/api/github/session'))
    expect(await response.json()).toEqual({ status: 'none' })
  })
})
