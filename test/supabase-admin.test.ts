import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  supabaseUrl,
  supabaseSecretKey,
  findRecordNameByEmail,
  getOptOutByEmail,
  getOptOutByDigest,
  insertOptOut,
  updateOptOut,
  confirmOptOut,
  type OptOutRow,
} from '@/lib/supabase-admin'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const KEY = 'service-role-key-123'

function upstreamJson(status: number, body: unknown): typeof fetch {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  return spy as unknown as typeof fetch
}

function calls(spy: typeof fetch): [string, Record<string, unknown>][] {
  return (spy as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][]
}

const row: OptOutRow = {
  id: 42,
  email: 'builder@example.com',
  token_digest: 'a'.repeat(64),
  expires_at: '2026-09-13T00:00:00.000Z',
  confirmed_at: null,
  last_sent_at: null,
}

describe('supabaseUrl', () => {
  it('defaults to the project URL', () => {
    expect(supabaseUrl()).toBe('https://faejimtdyfbawvdnvaly.supabase.co')
  })

  it('honors a SUPABASE_URL override', () => {
    vi.stubEnv('SUPABASE_URL', 'https://other-project.supabase.co')
    expect(supabaseUrl()).toBe('https://other-project.supabase.co')
  })
})

describe('supabaseSecretKey', () => {
  it('is null when unset', () => {
    expect(supabaseSecretKey()).toBeNull()
  })

  it('is null when empty', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    expect(supabaseSecretKey()).toBeNull()
  })

  it('reads the configured key', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sekret')
    expect(supabaseSecretKey()).toBe('sekret')
  })
})

describe('findRecordNameByEmail', () => {
  it('returns the name on a records hit', async () => {
    const spy = upstreamJson(200, [{ name: 'Ada Builder' }])
    vi.stubGlobal('fetch', spy)

    const result = await findRecordNameByEmail('builder@example.com', KEY)

    expect(result).toEqual({ name: 'Ada Builder' })
    const [url, init] = calls(spy)[0]
    expect(url).toContain('/rest/v1/records')
    expect(url).toContain('email=eq.builder%40example.com')
    const headers = init.headers as Record<string, string>
    expect(headers.apikey).toBe(KEY)
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('falls through to extra_emails on a records miss', async () => {
    const spy = vi.fn()
    spy.mockImplementationOnce(async (url: string) => {
      expect(String(url)).toContain('/rest/v1/records')
      return new Response(JSON.stringify([]), { status: 200 })
    })
    spy.mockImplementationOnce(async (url: string) => {
      expect(String(url)).toContain('/rest/v1/extra_emails')
      expect(String(url)).toContain('email=eq.secondary%40example.com')
      expect(String(url)).toContain('select=record_id,records(name)')
      return new Response(
        JSON.stringify([{ record_id: 1, records: { name: 'Secondary Name' } }]),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', spy)

    const result = await findRecordNameByEmail('secondary@example.com', KEY)

    expect(result).toEqual({ name: 'Secondary Name' })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('returns null when neither table matches', async () => {
    vi.stubGlobal('fetch', upstreamJson(200, []))

    expect(await findRecordNameByEmail('nobody@example.com', KEY)).toBeNull()
  })
})

describe('getOptOutByEmail', () => {
  it('returns the row on a hit', async () => {
    const spy = upstreamJson(200, [row])
    vi.stubGlobal('fetch', spy)

    expect(await getOptOutByEmail('builder@example.com', KEY)).toEqual(row)
    const [url] = calls(spy)[0]
    expect(url).toContain('/rest/v1/opt_outs')
    expect(url).toContain('email=eq.builder%40example.com')
  })

  it('returns null on a miss', async () => {
    vi.stubGlobal('fetch', upstreamJson(200, []))
    expect(await getOptOutByEmail('nobody@example.com', KEY)).toBeNull()
  })

  it('propagates a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    await expect(getOptOutByEmail('builder@example.com', KEY)).rejects.toThrow()
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', upstreamJson(500, { message: 'boom' }))
    await expect(getOptOutByEmail('builder@example.com', KEY)).rejects.toThrow()
  })
})

describe('getOptOutByDigest', () => {
  it('filters on token_digest', async () => {
    const spy = upstreamJson(200, [row])
    vi.stubGlobal('fetch', spy)

    expect(await getOptOutByDigest(row.token_digest, KEY)).toEqual(row)
    const [url] = calls(spy)[0]
    expect(url).toContain('/rest/v1/opt_outs')
    expect(url).toContain(`token_digest=eq.${row.token_digest}`)
  })

  it('returns null on a miss', async () => {
    vi.stubGlobal('fetch', upstreamJson(200, []))
    expect(await getOptOutByDigest('deadbeef', KEY)).toBeNull()
  })
})

describe('insertOptOut', () => {
  const fields = {
    email: 'builder@example.com',
    token_digest: 'b'.repeat(64),
    expires_at: '2026-09-13T00:00:00.000Z',
    last_sent_at: '2026-08-14T00:00:00.000Z',
  }

  it('returns inserted on 201', async () => {
    const spy = upstreamJson(201, [{ ...row, ...fields }])
    vi.stubGlobal('fetch', spy)

    expect(await insertOptOut(fields, KEY)).toBe('inserted')
    const [url, init] = calls(spy)[0]
    expect(url).toContain('/rest/v1/opt_outs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(fields)
  })

  it('returns conflict on 409', async () => {
    vi.stubGlobal('fetch', upstreamJson(409, { message: 'duplicate key' }))
    expect(await insertOptOut(fields, KEY)).toBe('conflict')
  })

  it('throws on a 500', async () => {
    vi.stubGlobal('fetch', upstreamJson(500, { message: 'boom' }))
    await expect(insertOptOut(fields, KEY)).rejects.toThrow()
  })
})

describe('updateOptOut', () => {
  it('PATCHes the row by id', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    vi.stubGlobal('fetch', spy)

    await updateOptOut(42, { last_sent_at: '2026-08-14T00:00:00.000Z' }, KEY)

    const [url, init] = calls(spy)[0]
    expect(url).toContain('/rest/v1/opt_outs?id=eq.42')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ last_sent_at: '2026-08-14T00:00:00.000Z' })
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', upstreamJson(500, { message: 'boom' }))
    await expect(updateOptOut(42, { last_sent_at: '2026-08-14T00:00:00.000Z' }, KEY)).rejects.toThrow()
  })
})

describe('confirmOptOut', () => {
  it('returns the row from the PATCH representation when it wins the race', async () => {
    const confirmed = { ...row, confirmed_at: '2026-08-14T12:00:00.000Z' }
    const spy = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toContain('/rest/v1/opt_outs?id=eq.42&confirmed_at=is.null')
      expect(init.method).toBe('PATCH')
      const headers = init.headers as Record<string, string>
      expect(headers.Prefer).toBe('return=representation')
      const body = JSON.parse(String(init.body))
      expect(typeof body.confirmed_at).toBe('string')
      return new Response(JSON.stringify([confirmed]), { status: 200 })
    })
    vi.stubGlobal('fetch', spy)

    const result = await confirmOptOut(42, KEY)

    expect(result).toEqual(confirmed)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('re-reads the row when it lost the race (already confirmed)', async () => {
    const confirmed = { ...row, confirmed_at: '2026-08-14T12:00:00.000Z' }
    const spy = vi.fn()
    spy.mockImplementationOnce(async () => new Response(JSON.stringify([]), { status: 200 }))
    spy.mockImplementationOnce(async (url: string) => {
      expect(String(url)).toContain('/rest/v1/opt_outs?id=eq.42')
      expect(String(url)).not.toContain('confirmed_at=is.null')
      return new Response(JSON.stringify([confirmed]), { status: 200 })
    })
    vi.stubGlobal('fetch', spy)

    const result = await confirmOptOut(42, KEY)

    expect(result).toEqual(confirmed)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('throws when the PATCH itself fails', async () => {
    vi.stubGlobal('fetch', upstreamJson(500, { message: 'boom' }))
    await expect(confirmOptOut(42, KEY)).rejects.toThrow()
  })
})
