import { describe, it, expect } from 'vitest'
import {
  authorizedFetch,
  DEVICE_CODE_ENDPOINT,
  fetchAuthenticatedUser,
  GITHUB_CLIENT_ID,
  pollForToken,
  requestDeviceCode,
  TOKEN_ENDPOINT,
} from '@/lib/github-auth'

const noSleep = async () => {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('requestDeviceCode', () => {
  it('posts our client id and maps snake_case', async () => {
    let captured: { url: string; body: string } | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body) }
      return jsonResponse({
        device_code: 'dev123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      })
    }) as typeof fetch
    const result = await requestDeviceCode(fakeFetch)
    expect(result).toEqual({
      status: 'ok',
      code: {
        deviceCode: 'dev123',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        interval: 5,
      },
    })
    expect(captured!.url).toBe(DEVICE_CODE_ENDPOINT)
    expect(captured!.body).toContain(GITHUB_CLIENT_ID)
  })
  it('maps HTTP failures and junk shapes to error', async () => {
    const httpFail = (async () => jsonResponse({}, 500)) as typeof fetch
    expect((await requestDeviceCode(httpFail)).status).toBe('error')
    const junk = (async () => jsonResponse({ nope: true })) as typeof fetch
    expect((await requestDeviceCode(junk)).status).toBe('error')
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await requestDeviceCode(netFail)).status).toBe('error')
  })
})

describe('pollForToken', () => {
  it('polls through authorization_pending to a token', async () => {
    const responses = [
      jsonResponse({ error: 'authorization_pending' }),
      jsonResponse({ error: 'authorization_pending' }),
      jsonResponse({ access_token: 'tok123', token_type: 'bearer' }),
    ]
    let calls = 0
    const fakeFetch = (async (url: unknown) => {
      expect(String(url)).toBe(TOKEN_ENDPOINT)
      return responses[calls++]
    }) as typeof fetch
    const result = await pollForToken('dev123', 5, { fetchFn: fakeFetch, sleep: noSleep })
    expect(result).toEqual({ status: 'token', token: 'tok123' })
    expect(calls).toBe(3)
  })
  it('slows down on slow_down and still succeeds', async () => {
    const sleeps: number[] = []
    const responses = [
      jsonResponse({ error: 'slow_down', interval: 10 }),
      jsonResponse({ access_token: 'tok123' }),
    ]
    let calls = 0
    const fakeFetch = (async () => responses[calls++]) as typeof fetch
    const result = await pollForToken('dev123', 5, {
      fetchFn: fakeFetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(result.status).toBe('token')
    expect(sleeps[0]).toBe(5000)
    expect(sleeps[1]).toBe(10000)
  })
  it('maps access_denied and expired_token', async () => {
    const denied = (async () => jsonResponse({ error: 'access_denied' })) as typeof fetch
    expect(await pollForToken('d', 1, { fetchFn: denied, sleep: noSleep })).toEqual({
      status: 'denied',
    })
    const expired = (async () => jsonResponse({ error: 'expired_token' })) as typeof fetch
    expect(await pollForToken('d', 1, { fetchFn: expired, sleep: noSleep })).toEqual({
      status: 'expired',
    })
  })
  it('stops when shouldStop flips', async () => {
    const pending = (async () => jsonResponse({ error: 'authorization_pending' })) as typeof fetch
    let polls = 0
    const result = await pollForToken('d', 1, {
      fetchFn: (async (...args: Parameters<typeof fetch>) => {
        polls++
        return pending(...args)
      }) as typeof fetch,
      sleep: noSleep,
      shouldStop: () => polls >= 2,
    })
    expect(result).toEqual({ status: 'cancelled' })
  })
  it('maps network failures to error', async () => {
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await pollForToken('d', 1, { fetchFn: netFail, sleep: noSleep })).status).toBe('error')
  })
})

describe('fetchAuthenticatedUser', () => {
  it('sends the bearer token and returns the login', async () => {
    let auth: string | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.github.com/user')
      auth = (init?.headers as Record<string, string>).Authorization
      return jsonResponse({ login: 'octocat' })
    }) as typeof fetch
    const result = await fetchAuthenticatedUser('tok123', fakeFetch)
    expect(result).toEqual({ status: 'ok', login: 'octocat' })
    expect(auth).toBe('Bearer tok123')
  })
  it('maps failures to error', async () => {
    const httpFail = (async () => jsonResponse({}, 401)) as typeof fetch
    expect((await fetchAuthenticatedUser('t', httpFail)).status).toBe('error')
  })
})

describe('authorizedFetch', () => {
  it('adds the Authorization header while preserving existing headers', async () => {
    const original = globalThis.fetch
    let seen: Record<string, string> | null = null
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>
      return jsonResponse({})
    }) as typeof fetch
    try {
      const wrapped = authorizedFetch('tok123')
      await wrapped('https://api.github.com/users/octocat', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      expect(seen).toEqual({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer tok123',
      })
    } finally {
      globalThis.fetch = original
    }
  })
})
