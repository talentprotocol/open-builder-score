import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as deviceCodePost } from '@/app/api/github/device-code/route'
import { POST as tokenPost } from '@/app/api/github/token/route'
import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('device-code route', () => {
  it('forwards our client id to GitHub and relays the response', async () => {
    let upstream: { url: string; body: string } | null = null
    vi.stubGlobal(
      'fetch',
      (async (url: unknown, init?: RequestInit) => {
        upstream = { url: String(url), body: String(init?.body) }
        return new Response(JSON.stringify({ device_code: 'dev123' }), { status: 200 })
      }) as typeof fetch,
    )
    const response = await deviceCodePost(jsonRequest({ client_id: GITHUB_CLIENT_ID }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ device_code: 'dev123' })
    expect(upstream!.url).toBe('https://github.com/login/device/code')
    expect(upstream!.body).toContain(GITHUB_CLIENT_ID)
  })
  it('rejects foreign client ids without contacting GitHub', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await deviceCodePost(jsonRequest({ client_id: 'someone-else' }))
    expect(response.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })
  it('rejects unparseable bodies', async () => {
    const response = await deviceCodePost(
      new Request('http://localhost/api/test', { method: 'POST', body: 'not json' }),
    )
    expect(response.status).toBe(400)
  })
})

describe('token route', () => {
  it('forwards with the device grant type pinned server-side', async () => {
    let body: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      (async (url: unknown, init?: RequestInit) => {
        expect(String(url)).toBe('https://github.com/login/oauth/access_token')
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ access_token: 'tok123' }), { status: 200 })
      }) as typeof fetch,
    )
    const response = await tokenPost(
      jsonRequest({
        client_id: GITHUB_CLIENT_ID,
        device_code: 'dev123',
        grant_type: 'urn:something-else-entirely',
      }),
    )
    expect(response.status).toBe(200)
    expect(body!.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(body!.device_code).toBe('dev123')
  })
  it('rejects foreign client ids and missing device codes', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(
      (await tokenPost(jsonRequest({ client_id: 'someone-else', device_code: 'd' }))).status,
    ).toBe(400)
    expect((await tokenPost(jsonRequest({ client_id: GITHUB_CLIENT_ID }))).status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })
})
