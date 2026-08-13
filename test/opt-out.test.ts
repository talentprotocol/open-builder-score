import { describe, it, expect } from 'vitest'
import {
  isLikelyEmail,
  requestOptOut,
  confirmOptOut,
  fetchOptOutStatus,
} from '@/lib/opt-out'

function jsonResponse(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch
}

function throwingFetch(): typeof fetch {
  return (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
}

describe('isLikelyEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isLikelyEmail('builder@example.com')).toBe(true)
  })

  it('accepts a subdomain and trims surrounding whitespace', () => {
    expect(isLikelyEmail('  builder@mail.example.com  ')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isLikelyEmail('')).toBe(false)
  })

  it('rejects a missing local part', () => {
    expect(isLikelyEmail('@example.com')).toBe(false)
  })

  it('rejects a missing @', () => {
    expect(isLikelyEmail('builder.example.com')).toBe(false)
  })

  it('rejects a domain with no dot', () => {
    expect(isLikelyEmail('builder@example')).toBe(false)
  })

  it('rejects a dot with nothing after it', () => {
    expect(isLikelyEmail('builder@example.')).toBe(false)
  })

  it('rejects a dot with nothing before it', () => {
    expect(isLikelyEmail('builder@.com')).toBe(false)
  })

  it('rejects embedded whitespace', () => {
    expect(isLikelyEmail('builder @example.com')).toBe(false)
  })
})

describe('requestOptOut', () => {
  it('reports sent on 200, regardless of body', async () => {
    const result = await requestOptOut('builder@example.com', jsonResponse({ success: true }))
    expect(result).toEqual({ status: 'sent' })
  })

  it('reports invalid with the upstream message on 422', async () => {
    const result = await requestOptOut(
      'not-an-email',
      jsonResponse({ error: 'email is invalid' }, 422),
    )
    expect(result).toEqual({ status: 'invalid', message: 'email is invalid' })
  })

  it('falls back to a generic message when the 422 body has no error field', async () => {
    const result = await requestOptOut('x', jsonResponse({}, 422))
    expect(result).toEqual({ status: 'invalid', message: 'Something went wrong.' })
  })

  it('reports rate-limited on 429', async () => {
    const result = await requestOptOut('builder@example.com', jsonResponse({ error: 'slow down' }, 429))
    expect(result).toEqual({ status: 'rate-limited' })
  })

  it('reports unavailable on 503', async () => {
    const result = await requestOptOut('builder@example.com', jsonResponse({ error: 'nope' }, 503))
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('reports unavailable when fetch throws', async () => {
    const result = await requestOptOut('builder@example.com', throwingFetch())
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('posts to the request proxy route with the email as JSON', async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined
    const spy = (async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return { status: 200, json: async () => ({ success: true }) } as Response
    }) as unknown as typeof fetch

    await requestOptOut('builder@example.com', spy)
    expect(capturedUrl).toBe('/api/opt-out/request')
    expect(capturedInit?.method).toBe('POST')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({ email: 'builder@example.com' })
  })
})

describe('confirmOptOut', () => {
  it('reports confirmed with the email on 200', async () => {
    const result = await confirmOptOut(
      'tok123',
      jsonResponse({ success: true, email: 'builder@example.com', confirmed_at: '2026-08-13T00:00:00Z' }),
    )
    expect(result).toEqual({ status: 'confirmed', email: 'builder@example.com' })
  })

  it('reports invalid on 422', async () => {
    const result = await confirmOptOut('bad-token', jsonResponse({ error: 'token is invalid' }, 422))
    expect(result).toEqual({ status: 'invalid' })
  })

  it('reports unavailable on an unexpected status', async () => {
    const result = await confirmOptOut('tok123', jsonResponse({ error: 'nope' }, 500))
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('reports unavailable when the 200 body is missing an email', async () => {
    const result = await confirmOptOut('tok123', jsonResponse({ success: true }))
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('reports unavailable when fetch throws', async () => {
    const result = await confirmOptOut('tok123', throwingFetch())
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('posts to the confirm proxy route with the token as JSON', async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined
    const spy = (async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return { status: 200, json: async () => ({ success: true, email: 'e@x.com' }) } as Response
    }) as unknown as typeof fetch

    await confirmOptOut('tok123', spy)
    expect(capturedUrl).toBe('/api/opt-out/confirm')
    expect(capturedInit?.method).toBe('POST')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({ token: 'tok123' })
  })
})

describe('fetchOptOutStatus', () => {
  it('reports ready with email and confirmed on 200', async () => {
    const result = await fetchOptOutStatus(
      'tok123',
      jsonResponse({ email: 'builder@example.com', confirmed: true }),
    )
    expect(result).toEqual({ status: 'ready', email: 'builder@example.com', confirmed: true })
  })

  it('reports invalid on 422', async () => {
    const result = await fetchOptOutStatus('bad-token', jsonResponse({ error: 'token is invalid' }, 422))
    expect(result).toEqual({ status: 'invalid' })
  })

  it('reports unavailable on an unexpected status', async () => {
    const result = await fetchOptOutStatus('tok123', jsonResponse({ error: 'nope' }, 500))
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('reports unavailable when the 200 body is malformed', async () => {
    const result = await fetchOptOutStatus('tok123', jsonResponse({ email: 'e@x.com' }))
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('reports unavailable when fetch throws', async () => {
    const result = await fetchOptOutStatus('tok123', throwingFetch())
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('gets the status proxy route with the token URL-encoded in the query string', async () => {
    let capturedUrl: string | undefined
    const spy = (async (url: string) => {
      capturedUrl = url
      return { status: 200, json: async () => ({ email: 'e@x.com', confirmed: false }) } as Response
    }) as unknown as typeof fetch

    await fetchOptOutStatus('tok with space', spy)
    expect(capturedUrl).toBe('/api/opt-out/status?token=tok%20with%20space')
  })
})
