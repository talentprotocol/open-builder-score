import { describe, it, expect } from 'vitest'
import { encodeAbiParameters } from 'viem'
import {
  fetchScoreAttestationHistory,
  HISTORY_QUERY,
  parseHistoryResponse,
} from '@/lib/history'
import { ATTEST_SCHEMA_UID } from '@/lib/eas'
import specJson from '../spec/spec.json'
import type { Spec } from '@/lib/types'

const spec = specJson as Spec
const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const UID = `0x${'cd'.repeat(32)}`

function encodeData(score: number, specVersion: string = spec.version): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'address' },
      { type: 'string' },
      { type: 'uint16' },
      { type: 'uint64' },
      { type: 'uint64' },
    ],
    [specVersion, WALLET, '', score, 1784975866n, 49093260n],
  )
}

function entry(overrides: Record<string, unknown> = {}) {
  return { id: UID, revocationTime: 0, timeCreated: 1784975900, data: encodeData(103), ...overrides }
}

describe('parseHistoryResponse', () => {
  it('decodes attestation summaries', () => {
    const result = parseHistoryResponse({ data: { attestations: [entry()] } })
    expect(result).toEqual({
      status: 'ok',
      attestations: [
        { uid: UID, score: 103, specVersion: spec.version, timeCreated: 1784975900, revoked: false },
      ],
    })
  })
  it('marks revoked entries', () => {
    const result = parseHistoryResponse({
      data: { attestations: [entry({ revocationTime: 1784976000 })] },
    })
    expect(result.status === 'ok' && result.attestations[0].revoked).toBe(true)
  })
  it('skips undecodable entries but keeps good ones', () => {
    const result = parseHistoryResponse({
      data: { attestations: [entry({ data: '0x1234' }), entry()] },
    })
    expect(result.status === 'ok' && result.attestations).toHaveLength(1)
  })
  it('maps junk shapes to error', () => {
    expect(parseHistoryResponse(null).status).toBe('error')
    expect(parseHistoryResponse({ data: {} }).status).toBe('error')
  })
})

describe('fetchScoreAttestationHistory', () => {
  it('posts recipient + schema and parses the list', async () => {
    let body = ''
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ data: { attestations: [entry()] } }), { status: 200 })
    }) as typeof fetch
    const result = await fetchScoreAttestationHistory(WALLET.toLowerCase(), fakeFetch)
    expect(result.status).toBe('ok')
    expect(body).toContain(WALLET) // checksummed recipient
    expect(body).toContain(ATTEST_SCHEMA_UID)
    expect(body).toContain(HISTORY_QUERY.slice(0, 20))
  })
  it('maps HTTP and network failures to error', async () => {
    const httpFail = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect((await fetchScoreAttestationHistory(WALLET, httpFail)).status).toBe('error')
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await fetchScoreAttestationHistory(WALLET, netFail)).status).toBe('error')
  })
  it('rejects invalid wallets without fetching', async () => {
    let called = false
    const fakeFetch = (async () => {
      called = true
      return new Response('{}')
    }) as typeof fetch
    expect((await fetchScoreAttestationHistory('nope', fakeFetch)).status).toBe('error')
    expect(called).toBe(false)
  })
})
