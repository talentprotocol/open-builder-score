import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as requestPost } from '@/app/api/opt-out/request/route'
import { POST as confirmPost } from '@/app/api/opt-out/confirm/route'
import { GET as statusGet } from '@/app/api/opt-out/status/route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postRaw(url: string, body: string): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
}

function upstreamJson(status: number, body: unknown): typeof fetch {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  return spy as unknown as typeof fetch
}

describe('request route', () => {
  it('rejects a missing email with 400', async () => {
    const response = await requestPost(postJson('http://localhost:3000/api/opt-out/request', {}))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'email is required' })
  })

  it('rejects a blank email with 400', async () => {
    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: '   ' }),
    )
    expect(response.status).toBe(400)
  })

  it('rejects an unparseable body with 400', async () => {
    const response = await requestPost(postRaw('http://localhost:3000/api/opt-out/request', 'not json'))
    expect(response.status).toBe(400)
  })

  it('reports 503 when TALENT_API_KEY is unset', async () => {
    vi.stubEnv('TALENT_API_KEY', '')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: 'builder@example.com' }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Opt-out isn't configured on this deployment" })
    expect(spy).not.toHaveBeenCalled()
  })

  it('forwards to talent-api with the X-API-KEY header and relays a 200 verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubEnv('TALENT_API_URL', 'https://api.talentprotocol.test')
    const spy = upstreamJson(200, { success: true })
    vi.stubGlobal('fetch', spy)

    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: 'builder@example.com' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.talentprotocol.test/data_transfer_opt_outs')
    expect(init.method).toBe('POST')
    expect(init.headers['X-API-KEY']).toBe('sekret')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ email: 'builder@example.com' })
  })

  it('relays a 200 verbatim for a non-matching email too (anti-enumeration)', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal('fetch', upstreamJson(200, { success: true }))

    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: 'nobody@example.com' }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it('relays a 422 status and body verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal('fetch', upstreamJson(422, { error: 'email is invalid' }))

    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: 'not-an-email' }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'email is invalid' })
  })

  it('relays a 429 status and body verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal('fetch', upstreamJson(429, { error: 'too many requests' }))

    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: 'builder@example.com' }),
    )
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'too many requests' })
  })

  it('reports 502 without leaking internals when talent-api is unreachable', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED 10.0.0.1:443 secret-internal-detail')
      }),
    )

    const response = await requestPost(
      postJson('http://localhost:3000/api/opt-out/request', { email: 'builder@example.com' }),
    )
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error).not.toContain('ECONNREFUSED')
    expect(body.error).not.toContain('10.0.0.1')
  })
})

describe('confirm route', () => {
  it('rejects a missing token with 400', async () => {
    const response = await confirmPost(postJson('http://localhost:3000/api/opt-out/confirm', {}))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'token is required' })
  })

  it('reports 503 when TALENT_API_KEY is unset', async () => {
    vi.stubEnv('TALENT_API_KEY', '')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await confirmPost(
      postJson('http://localhost:3000/api/opt-out/confirm', { token: 'tok123' }),
    )
    expect(response.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
  })

  it('forwards to talent-api with the X-API-KEY header and relays a 200 verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, {
      success: true,
      email: 'builder@example.com',
      confirmed_at: '2026-08-13T00:00:00Z',
    })
    vi.stubGlobal('fetch', spy)

    const response = await confirmPost(
      postJson('http://localhost:3000/api/opt-out/confirm', { token: 'tok123' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      email: 'builder@example.com',
      confirmed_at: '2026-08-13T00:00:00Z',
    })

    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.talentprotocol.com/data_transfer_opt_outs/confirm')
    expect(init.method).toBe('POST')
    expect(init.headers['X-API-KEY']).toBe('sekret')
    expect(JSON.parse(init.body)).toEqual({ token: 'tok123' })
  })

  it('relays a 422 status and body verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal('fetch', upstreamJson(422, { error: 'token is invalid or expired' }))

    const response = await confirmPost(
      postJson('http://localhost:3000/api/opt-out/confirm', { token: 'bad-token' }),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'token is invalid or expired' })
  })

  it('reports 502 without leaking internals when talent-api is unreachable', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const response = await confirmPost(
      postJson('http://localhost:3000/api/opt-out/confirm', { token: 'tok123' }),
    )
    expect(response.status).toBe(502)
  })
})

describe('status route', () => {
  it('rejects a missing token with 400', async () => {
    const response = await statusGet(new Request('http://localhost:3000/api/opt-out/status'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'token is required' })
  })

  it('reports 503 when TALENT_API_KEY is unset', async () => {
    vi.stubEnv('TALENT_API_KEY', '')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await statusGet(
      new Request('http://localhost:3000/api/opt-out/status?token=tok123'),
    )
    expect(response.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
  })

  it('forwards to talent-api with the X-API-KEY header and relays a 200 verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, { email: 'builder@example.com', confirmed: false })
    vi.stubGlobal('fetch', spy)

    const response = await statusGet(
      new Request('http://localhost:3000/api/opt-out/status?token=tok123'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: 'builder@example.com', confirmed: false })

    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.talentprotocol.com/data_transfer_opt_outs/status?token=tok123')
    expect(init.headers['X-API-KEY']).toBe('sekret')
  })

  it('URL-encodes the token when forwarding', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, { email: 'builder@example.com', confirmed: true })
    vi.stubGlobal('fetch', spy)

    await statusGet(
      new Request(
        `http://localhost:3000/api/opt-out/status?token=${encodeURIComponent('tok with space')}`,
      ),
    )

    const [url] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.talentprotocol.com/data_transfer_opt_outs/status?token=tok%20with%20space')
  })

  it('relays a 422 status and body verbatim', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal('fetch', upstreamJson(422, { error: 'token is invalid' }))

    const response = await statusGet(
      new Request('http://localhost:3000/api/opt-out/status?token=bad-token'),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'token is invalid' })
  })

  it('reports 502 without leaking internals when talent-api is unreachable', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const response = await statusGet(
      new Request('http://localhost:3000/api/opt-out/status?token=tok123'),
    )
    expect(response.status).toBe(502)
  })
})
