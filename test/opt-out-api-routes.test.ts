import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { POST as requestPost } from '@/app/api/opt-out/request/route'
import { POST as confirmPost } from '@/app/api/opt-out/confirm/route'
import { GET as statusGet } from '@/app/api/opt-out/status/route'
import {
  supabaseSecretKey,
  findRecordNameByEmail,
  getOptOutByEmail,
  getOptOutByDigest,
  insertOptOut,
  updateOptOut,
  confirmOptOut,
  type OptOutRow,
} from '@/lib/supabase-admin'
import { sendgridApiKey, sendOptOutConfirmationEmail } from '@/lib/sendgrid'

// All three opt-out routes call into these two lib modules instead of fetch
// directly, so their tests mock the modules rather than stubbing global
// fetch.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseSecretKey: vi.fn(),
  findRecordNameByEmail: vi.fn(),
  getOptOutByEmail: vi.fn(),
  getOptOutByDigest: vi.fn(),
  insertOptOut: vi.fn(),
  updateOptOut: vi.fn(),
  confirmOptOut: vi.fn(),
}))

vi.mock('@/lib/sendgrid', () => ({
  sendgridApiKey: vi.fn(),
  sendOptOutConfirmationEmail: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  // resetAllMocks (not clearAllMocks): clearing only wipes call history and
  // leaves a `mockReturnValue`/`mockResolvedValue` set by one test in place
  // for the next one. Every test below configures exactly the mock behavior
  // it needs, so isolation must not depend on run order.
  vi.resetAllMocks()
  vi.useRealTimers()
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
    expect(await response.json()).toEqual({ error: 'email is required' })
  })

  it('rejects a blank email with 400', async () => {
    const response = await requestPost(postJson(REQUEST_URL, { email: '   ' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'email is required' })
  })

  it('rejects an unparseable body with 400', async () => {
    const response = await requestPost(postRaw(REQUEST_URL, 'not json'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'email is required' })
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

  it('treats an unparseable last_sent_at as within cooldown (fails closed, no resend)', async () => {
    configuredKeys()
    vi.mocked(findRecordNameByEmail).mockResolvedValue({ name: 'Ada Builder' })
    vi.mocked(getOptOutByEmail).mockResolvedValue(optOutRow({ last_sent_at: 'not-a-timestamp' }))

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

  it('returns success within the deadline when a lookup call never settles, and logs nothing', async () => {
    vi.useFakeTimers()
    configuredKeys()
    // Simulates a black-hole stall (no reject, no resolve — unlike a fast
    // connection-refused, which the catch-all already covers): under an
    // upstream outage this is the exact path that would otherwise let a
    // platform timeout leak whether the email matched.
    vi.mocked(findRecordNameByEmail).mockReturnValue(new Promise(() => {}))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const responsePromise = requestPost(postJson(REQUEST_URL, { email: 'builder@example.com' }))
    await vi.advanceTimersByTimeAsync(8_000)
    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SUCCESS_BODY)
    expect(sendOptOutConfirmationEmail).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

const CONFIRM_URL = `${ORIGIN}/api/opt-out/confirm`
const STATUS_URL = `${ORIGIN}/api/opt-out/status`

describe('confirm route', () => {
  it('rejects a missing token with 400', async () => {
    const response = await confirmPost(postJson(CONFIRM_URL, {}))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'token is required' })
    expect(supabaseSecretKey).not.toHaveBeenCalled()
  })

  it('rejects a blank token with 400', async () => {
    const response = await confirmPost(postJson(CONFIRM_URL, { token: '   ' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'token is required' })
  })

  it("reports 503 when Supabase isn't configured", async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(null)

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Opt-out isn't configured on this deployment" })
    expect(getOptOutByDigest).not.toHaveBeenCalled()
  })

  it('reports 422 when no row matches the token digest', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(null)

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Invalid or expired link' })
    expect(confirmOptOut).not.toHaveBeenCalled()
  })

  it('reports 422 for an expired, unconfirmed row', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(
      optOutRow({ expires_at: new Date(Date.now() - 1_000).toISOString(), confirmed_at: null }),
    )

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Invalid or expired link' })
    expect(confirmOptOut).not.toHaveBeenCalled()
  })

  it('returns 200 for an expired row that is already confirmed (confirmed-before-expired)', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    const row = optOutRow({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      confirmed_at: '2026-08-01T00:00:00.000Z',
    })
    vi.mocked(getOptOutByDigest).mockResolvedValue(row)

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      email: row.email,
      confirmed_at: row.confirmed_at,
    })
    expect(confirmOptOut).not.toHaveBeenCalled()
  })

  it('confirms a fresh row and returns its new confirmed_at', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    const row = optOutRow({ confirmed_at: null })
    vi.mocked(getOptOutByDigest).mockResolvedValue(row)
    const confirmed: OptOutRow = { ...row, confirmed_at: '2026-08-14T00:00:00.000Z' }
    vi.mocked(confirmOptOut).mockResolvedValue(confirmed)

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      email: confirmed.email,
      confirmed_at: confirmed.confirmed_at,
    })
    expect(confirmOptOut).toHaveBeenCalledTimes(1)
    expect(confirmOptOut).toHaveBeenCalledWith(row.id, SUPABASE_KEY)
  })

  it('returns the ORIGINAL confirmed_at for an already-confirmed row without re-confirming', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    const row = optOutRow({ confirmed_at: '2026-08-01T00:00:00.000Z' })
    vi.mocked(getOptOutByDigest).mockResolvedValue(row)

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      email: row.email,
      confirmed_at: row.confirmed_at,
    })
    expect(confirmOptOut).not.toHaveBeenCalled()
  })

  it('hashes the token before lookup, never sending the raw token to Supabase', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(null)
    const rawToken = 'raw-token-value'

    await confirmPost(postJson(CONFIRM_URL, { token: rawToken }))

    expect(getOptOutByDigest).toHaveBeenCalledTimes(1)
    const [digestArg] = vi.mocked(getOptOutByDigest).mock.calls[0]
    expect(digestArg).toBe(createHash('sha256').update(rawToken).digest('hex'))
    expect(digestArg).not.toBe(rawToken)
  })

  it('reports 502 without leaking internals when the Supabase lookup throws', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockRejectedValue(
      new Error(`Supabase opt_outs lookup failed: https://x.supabase.co/rest/v1/opt_outs?token_digest=eq.${'a'.repeat(64)}`),
    )

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Upstream failure' })
  })

  it('reports 502 without leaking internals when confirmOptOut throws', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(optOutRow({ confirmed_at: null }))
    vi.mocked(confirmOptOut).mockRejectedValue(new Error('Supabase opt_outs confirm failed (500)'))

    const response = await confirmPost(postJson(CONFIRM_URL, { token: 'tok123' }))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Upstream failure' })
  })
})

describe('status route', () => {
  it('rejects a missing token with 400', async () => {
    const response = await statusGet(new Request(STATUS_URL))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'token is required' })
    expect(supabaseSecretKey).not.toHaveBeenCalled()
  })

  it("reports 503 when Supabase isn't configured", async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(null)

    const response = await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Opt-out isn't configured on this deployment" })
    expect(getOptOutByDigest).not.toHaveBeenCalled()
  })

  it('reports 422 when no row matches the token digest', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(null)

    const response = await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Invalid or expired link' })
  })

  it('reports 422 for an expired, unconfirmed row', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(
      optOutRow({ expires_at: new Date(Date.now() - 1_000).toISOString(), confirmed_at: null }),
    )

    const response = await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Invalid or expired link' })
  })

  it('returns 200 for an expired row that is already confirmed (confirmed-before-expired)', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    const row = optOutRow({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      confirmed_at: '2026-08-01T00:00:00.000Z',
    })
    vi.mocked(getOptOutByDigest).mockResolvedValue(row)

    const response = await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: row.email, confirmed: true })
  })

  it('returns confirmed:false for a fresh, unconfirmed row', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    const row = optOutRow({ confirmed_at: null })
    vi.mocked(getOptOutByDigest).mockResolvedValue(row)

    const response = await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: row.email, confirmed: false })
  })

  it('hashes the token before lookup, never sending the raw token to Supabase', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(null)
    const rawToken = 'tok with space'

    await statusGet(new Request(`${STATUS_URL}?token=${encodeURIComponent(rawToken)}`))

    expect(getOptOutByDigest).toHaveBeenCalledTimes(1)
    const [digestArg] = vi.mocked(getOptOutByDigest).mock.calls[0]
    expect(digestArg).toBe(createHash('sha256').update(rawToken).digest('hex'))
    expect(digestArg).not.toBe(rawToken)
  })

  it('never calls a mutating function — GET is read-only', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockResolvedValue(optOutRow({ confirmed_at: null }))

    await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(confirmOptOut).not.toHaveBeenCalled()
    expect(insertOptOut).not.toHaveBeenCalled()
    expect(updateOptOut).not.toHaveBeenCalled()
  })

  it('reports 502 without leaking internals when the Supabase lookup throws', async () => {
    vi.mocked(supabaseSecretKey).mockReturnValue(SUPABASE_KEY)
    vi.mocked(getOptOutByDigest).mockRejectedValue(
      new Error(`Supabase opt_outs lookup failed: https://x.supabase.co/rest/v1/opt_outs?token_digest=eq.${'a'.repeat(64)}`),
    )

    const response = await statusGet(new Request(`${STATUS_URL}?token=tok123`))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Upstream failure' })
  })
})
