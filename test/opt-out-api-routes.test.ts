import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { POST as requestPost } from '@/app/api/opt-out/request/route'
import { POST as confirmPost } from '@/app/api/opt-out/confirm/route'
import { GET as statusGet } from '@/app/api/opt-out/status/route'
import {
  supabaseSecretKey,
  findRecordNameByEmail,
  getOptOutByEmail,
  insertOptOut,
  updateOptOut,
  type OptOutRow,
} from '@/lib/supabase-admin'
import { sendgridApiKey, sendOptOutConfirmationEmail } from '@/lib/sendgrid'

// The request route (unlike confirm/status, still proxying talent-api below)
// no longer calls fetch directly — it goes through these two lib modules —
// so its tests mock the modules instead of stubbing global fetch.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseSecretKey: vi.fn(),
  findRecordNameByEmail: vi.fn(),
  getOptOutByEmail: vi.fn(),
  insertOptOut: vi.fn(),
  updateOptOut: vi.fn(),
}))

vi.mock('@/lib/sendgrid', () => ({
  sendgridApiKey: vi.fn(),
  sendOptOutConfirmationEmail: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

function postJson(url: string, body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
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

const ORIGIN = 'http://localhost:3000'
const REQUEST_URL = `${ORIGIN}/api/opt-out/request`
const CONFIRM_PREFIX = `${ORIGIN}/data-opt-out/confirm/`
const SUPABASE_KEY = 'supabase-key-123'
const SENDGRID_KEY = 'sendgrid-key-123'
const SUCCESS_BODY = '{"success":true}'
const HEX64 = /^[0-9a-f]{64}$/
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

function configuredKeys(): void {
  vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
  vi.mocked(sendgridApiKey).mockReturnValue(SENDGRID_KEY)
}

function optOutRow(overrides: Partial<OptOutRow> = {}): OptOutRow {
  return {
    id: 42,
    email: 'builder@example.com',
    token_digest: 'a'.repeat(64),
    expires_at: '2026-09-13T00:00:00.000Z',
    confirmed_at: null,
    last_sent_at: null,
    ...overrides,
  }
}

function tokenFromConfirmUrl(confirmUrl: string): string {
  expect(confirmUrl.startsWith(CONFIRM_PREFIX)).toBe(true)
  return confirmUrl.slice(CONFIRM_PREFIX.length)
}

describe('request route', () => {
  it('rejects a missing email with 400', async () => {
    const response = await requestPost(postJson(REQUEST_URL, {}))
    expect(response.status).toBe(400)
  })

  it('rejects a blank email with 400', async () => {
    const response = await requestPost(postJson(REQUEST_URL, { email: '   ' }))
    expect(response.status).toBe(400)
  })

  it('rejects an unparseable body with 400', async () => {
    const response = await requestPost(postRaw(REQUEST_URL, 'not json'))
    expect(response.status).toBe(400)
  })

  it("reports 503 when Supabase isn't configured", async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(null)
    vi.mocked(sendgridApiKey).mockReturnValue(SENDGRID_KEY)

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Opt-out isn't configured on this deployment" })
    expect(findRecordNameByEmail).not.toHaveBeenCalled()
  })

  it("reports 503 when SendGrid isn't configured", async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(sendgridApiKey).mockReturnValue(null)

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Opt-out isn't configured on this deployment" })
    expect(findRecordNameByEmail).not.toHaveBeenCalled()
  })

  it('rejects an invalid email format with 422', async () => {
    configuredKeys()

    const response = await requestPost(postJson(REQUEST_URL, { email: 'not-an-email' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Invalid email format' })
    expect(findRecordNameByEmail).not.toHaveBeenCalled()
  })

  it('returns success with no send when the email matches no record (anti-enumeration)', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue(null)

    const response = await requestPost(postJson(REQUEST_URL, { email: 'nobody@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(sendOptOutConfirmationEmail).not.toHaveBeenCalled()
  })

  it('mints a token and sends when the email matches and has no opt-out row yet', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    vi.mocked(getOptOutByEmail).mockResolvedValue(null)
    vi.mocked(insertOptOut).mockResolvedValue('inserted')
    vi.mocked(sendOptOutConfirmationEmail).mockResolvedValue(undefined)

    const before = Date.now()
    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))
    const after = Date.now()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)

    expect(insertOptOut).toHaveBeenCalledTimes(1)
    const [insertedFields] = vi.mocked(insertOptOut).mock.calls[0]
    expect(insertedFields.email).toBe('builder@example.com')
    expect(insertedFields.token_digest).toMatch(HEX64)
    expect(typeof insertedFields.last_sent_at).toBe('string')
    const expiresAt = Date.parse(insertedFields.expires_at)
    expect(expiresAt).toBeGreaterThanOrEqual(before + TOKEN_TTL_MS - 5_000)
    expect(expiresAt).toBeLessThanOrEqual(after + TOKEN_TTL_MS + 5_000)

    expect(sendOptOutConfirmationEmail).toHaveBeenCalledTimes(1)
    const [sendArgs] = vi.mocked(sendOptOutConfirmationEmail).mock.calls[0]
    expect(sendArgs.to).toBe('builder@example.com')
    expect(sendArgs.firstName).toBe('Ada Builder')
    const token = tokenFromConfirmUrl(sendArgs.confirmUrl)
    expect(token).toMatch(HEX64)
    expect(createHash('sha256').update(token).digest('hex')).toBe(insertedFields.token_digest)
  })

  it('returns success with no send when the opt-out is already confirmed', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    vi.mocked(getOptOutByEmail).mockResolvedValue(
      optOutRow({ confirmed_at: '2026-08-01T00:00:00.000Z' }),
    )

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(sendOptOutConfirmationEmail).not.toHaveBeenCalled()
    expect(insertOptOut).not.toHaveBeenCalled()
    expect(updateOptOut).not.toHaveBeenCalled()
  })

  it('returns success with no send when a resend is on cooldown', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    vi.mocked(getOptOutByEmail).mockResolvedValue(
      optOutRow({ last_sent_at: new Date(Date.now() - 60_000).toISOString() }),
    )

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(sendOptOutConfirmationEmail).not.toHaveBeenCalled()
    expect(updateOptOut).not.toHaveBeenCalled()
    expect(insertOptOut).not.toHaveBeenCalled()
  })

  it('re-mints and resends once the cooldown has elapsed, without touching confirmed_at', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    const existing = optOutRow({ last_sent_at: new Date(Date.now() - 10 * 60_000).toISOString() })
    vi.mocked(getOptOutByEmail).mockResolvedValue(existing)
    vi.mocked(updateOptOut).mockResolvedValue(undefined)
    vi.mocked(sendOptOutConfirmationEmail).mockResolvedValue(undefined)

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(insertOptOut).not.toHaveBeenCalled()

    expect(updateOptOut).toHaveBeenCalledTimes(1)
    const [id, fields] = vi.mocked(updateOptOut).mock.calls[0]
    expect(id).toBe(existing.id)
    expect(fields.token_digest).toMatch(HEX64)
    expect(fields.token_digest).not.toBe(existing.token_digest)
    expect(Date.parse(fields.expires_at as string)).toBeGreaterThan(Date.parse(existing.expires_at))
    expect('confirmed_at' in fields).toBe(false)

    const [sendArgs] = vi.mocked(sendOptOutConfirmationEmail).mock.calls[0]
    const token = tokenFromConfirmUrl(sendArgs.confirmUrl)
    expect(createHash('sha256').update(token).digest('hex')).toBe(fields.token_digest)
  })

  it('returns success with no send when insertOptOut reports a conflict (double-submit race)', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    vi.mocked(getOptOutByEmail).mockResolvedValue(null)
    vi.mocked(insertOptOut).mockResolvedValue('conflict')

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(sendOptOutConfirmationEmail).not.toHaveBeenCalled()
  })

  it('still returns success when sendOptOutConfirmationEmail throws, and logs nothing', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    vi.mocked(getOptOutByEmail).mockResolvedValue(null)
    vi.mocked(insertOptOut).mockResolvedValue('inserted')
    vi.mocked(sendOptOutConfirmationEmail).mockRejectedValue(
      new Error('sendgrid_send_failed for builder@example.com via https://api.sendgrid.com/v3/mail/send'),
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('still returns success when the Supabase lookup itself throws, and logs nothing', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockRejectedValue(
      new Error('fetch failed: https://faejimtdyfbawvdnvaly.supabase.co/rest/v1/records?email=eq.builder@example.com'),
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('normalizes email casing/whitespace before lookup', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue(null)

    await requestPost(postJson(REQUEST_URL, { email: '  Builder@Example.COM  ' }))

    expect(findRecordNameByEmail).toHaveBeenCalledWith('builder@example.com', SUPABASE_KEY)
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

  it('forwards the first x-forwarded-for hop upstream as X-Client-IP', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, { success: true, email: 'builder@example.com' })
    vi.stubGlobal('fetch', spy)

    await confirmPost(
      postJson(
        'http://localhost:3000/api/opt-out/confirm',
        { token: 'tok123' },
        { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      ),
    )

    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers['X-Client-IP']).toBe('203.0.113.5')
  })

  it('omits X-Client-IP when x-forwarded-for is absent (local dev)', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, { success: true, email: 'builder@example.com' })
    vi.stubGlobal('fetch', spy)

    await confirmPost(postJson('http://localhost:3000/api/opt-out/confirm', { token: 'tok123' }))

    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect('X-Client-IP' in init.headers).toBe(false)
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

  it('forwards the first x-forwarded-for hop upstream as X-Client-IP', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, { email: 'builder@example.com', confirmed: false })
    vi.stubGlobal('fetch', spy)

    await statusGet(
      new Request('http://localhost:3000/api/opt-out/status?token=tok123', {
        headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      }),
    )

    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers['X-Client-IP']).toBe('203.0.113.5')
  })

  it('omits X-Client-IP when x-forwarded-for is absent (local dev)', async () => {
    vi.stubEnv('TALENT_API_KEY', 'sekret')
    const spy = upstreamJson(200, { email: 'builder@example.com', confirmed: false })
    vi.stubGlobal('fetch', spy)

    await statusGet(new Request('http://localhost:3000/api/opt-out/status?token=tok123'))

    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect('X-Client-IP' in init.headers).toBe(false)
  })
})
