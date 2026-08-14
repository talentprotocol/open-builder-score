import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendgridApiKey, sendOptOutConfirmationEmail } from '@/lib/sendgrid'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const KEY = 'sg-key-123'
const CONFIRM_URL = 'https://example.com/opt-out/confirm?token=abc123'

function upstream(status: number): typeof fetch {
  return vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch
}

function calls(spy: typeof fetch): [string, Record<string, unknown>][] {
  return (spy as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][]
}

describe('sendgridApiKey', () => {
  it('is null when unset', () => {
    expect(sendgridApiKey()).toBeNull()
  })

  it('is null when empty', () => {
    vi.stubEnv('SENDGRID_API_KEY', '')
    expect(sendgridApiKey()).toBeNull()
  })

  it('reads the configured key', () => {
    vi.stubEnv('SENDGRID_API_KEY', 'sekret')
    expect(sendgridApiKey()).toBe('sekret')
  })
})

describe('sendOptOutConfirmationEmail', () => {
  it('POSTs to the SendGrid v3 endpoint with a bearer auth header', async () => {
    const spy = upstream(202)
    vi.stubGlobal('fetch', spy)

    await sendOptOutConfirmationEmail(
      { to: 'builder@example.com', firstName: 'Ada', confirmUrl: CONFIRM_URL },
      KEY,
    )

    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = calls(spy)[0]
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('builds a payload with the recipient, sender, subject, and text-before-html content', async () => {
    const spy = upstream(202)
    vi.stubGlobal('fetch', spy)

    await sendOptOutConfirmationEmail(
      { to: 'builder@example.com', firstName: 'Ada', confirmUrl: CONFIRM_URL },
      KEY,
    )

    const [, init] = calls(spy)[0]
    const body = JSON.parse(init.body as string)

    expect(body.personalizations[0].to[0].email).toBe('builder@example.com')
    expect(body.from).toEqual({ email: 'no-reply@talentprotocol.com', name: 'Talent Protocol' })
    expect(body.subject).toBe('Confirm your data-transfer opt-out')

    expect(body.content).toHaveLength(2)
    expect(body.content[0].type).toBe('text/plain')
    expect(body.content[1].type).toBe('text/html')

    for (const part of body.content) {
      expect(part.value).toContain(CONFIRM_URL)
      expect(part.value).toContain('Hi Ada,')
    }
  })

  it('falls back to the "there" greeting when firstName is null', async () => {
    const spy = upstream(202)
    vi.stubGlobal('fetch', spy)

    await sendOptOutConfirmationEmail(
      { to: 'builder@example.com', firstName: null, confirmUrl: CONFIRM_URL },
      KEY,
    )

    const [, init] = calls(spy)[0]
    const body = JSON.parse(init.body as string)
    for (const part of body.content) {
      expect(part.value).toContain('Hi there,')
    }
  })

  it('throws on a non-202 response', async () => {
    vi.stubGlobal('fetch', upstream(400))

    await expect(
      sendOptOutConfirmationEmail(
        { to: 'builder@example.com', firstName: 'Ada', confirmUrl: CONFIRM_URL },
        KEY,
      ),
    ).rejects.toThrow('sendgrid_send_failed')
  })

  it('accepts 202 and resolves without error', async () => {
    vi.stubGlobal('fetch', upstream(202))

    await expect(
      sendOptOutConfirmationEmail(
        { to: 'builder@example.com', firstName: 'Ada', confirmUrl: CONFIRM_URL },
        KEY,
      ),
    ).resolves.toBeUndefined()
  })

  it('does not log the email, key, or confirm url on a successful send', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', upstream(202))

    await sendOptOutConfirmationEmail(
      { to: 'builder@example.com', firstName: 'Ada', confirmUrl: CONFIRM_URL },
      KEY,
    )

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('the failure error message contains none of the email, key, or confirm url', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', upstream(500))

    let caught: Error | null = null
    try {
      await sendOptOutConfirmationEmail(
        { to: 'builder@example.com', firstName: 'Ada', confirmUrl: CONFIRM_URL },
        KEY,
      )
    } catch (error) {
      caught = error as Error
    }

    expect(caught).not.toBeNull()
    const message = caught?.message ?? ''
    expect(message).not.toContain('builder@example.com')
    expect(message).not.toContain(KEY)
    expect(message).not.toContain(CONFIRM_URL)

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
