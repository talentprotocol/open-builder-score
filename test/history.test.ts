import { describe, it, expect } from 'vitest'
import { encodeAbiParameters } from 'viem'
import {
  fetchScoreAttestationHistory,
  HISTORY_QUERY,
  parseHistoryResponse,
} from '@/lib/history'
import { ATTEST_SCHEMA_UID, ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID } from '@/lib/eas'
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
  return {
    id: UID,
    schemaId: ATTEST_SCHEMA_UID,
    revocationTime: 0,
    timeCreated: 1784975900,
    data: encodeData(103),
    ...overrides,
  }
}

describe('parseHistoryResponse', () => {
  it('decodes attestation summaries', () => {
    const result = parseHistoryResponse({ data: { attestations: [entry()] } })
    expect(result).toEqual({
      status: 'ok',
      attestations: [
        {
          uid: UID,
          score: 103,
          specVersion: spec.version,
          walletCount: 1,
          timeCreated: 1784975900,
          revoked: false,
        },
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

describe('parseHistoryResponse tolerant contract', () => {
  it('returns ok with an empty list when every entry is undecodable', () => {
    const result = parseHistoryResponse({
      data: { attestations: [entry({ data: '0x1234' }), entry({ data: '0xdead' })] },
    })
    expect(result).toEqual({ status: 'ok', attestations: [] })
  })
})

const singleData = encodeData(103)
const aggregateData = encodeAbiParameters(
  [
    { type: 'string' },
    { type: 'address' },
    { type: 'address[]' },
    { type: 'bytes[]' },
    { type: 'string' },
    { type: 'uint16' },
    { type: 'uint64' },
    { type: 'uint64' },
    { type: 'string' },
    { type: 'string[]' },
  ],
  [
    spec.version,
    WALLET,
    ['0x1563915e194D8CfBA1943570603F7606A3115508', '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'],
    [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
    'octocat',
    131,
    1784975866n,
    49093260n,
    'https://talentprotocol.com/score/x',
    ['talent_token_launched'],
  ],
)

describe('history across both schema versions', () => {
  it('asks easscan for both schemas and selects the schemaId it dispatches on', () => {
    expect(HISTORY_QUERY).toMatch(/schemaId:\s*\{\s*in:\s*\$schema_ids\s*\}/)
    expect(HISTORY_QUERY).toMatch(/\$schema_ids:\s*\[String!\]!/)
    // Without selecting schemaId the decoder would have to guess which schema a
    // row used, which is exactly what decodeAttestationData refuses to do.
    expect(HISTORY_QUERY).toMatch(/^\s*schemaId\s*$/m)
  })

  it('reports how many wallets each attestation covers', () => {
    const parsed = parseHistoryResponse({
      data: {
        attestations: [
          { id: `0x${'11'.repeat(32)}`, schemaId: ATTEST_SCHEMA_UID, revocationTime: 0, timeCreated: 100, data: singleData },
          { id: `0x${'22'.repeat(32)}`, schemaId: ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID, revocationTime: 0, timeCreated: 200, data: aggregateData },
        ],
      },
    })
    expect(parsed.status).toBe('ok')
    expect(parsed.status === 'ok' && parsed.attestations.map((a) => a.walletCount)).toEqual([1, 3])
  })

  it('skips a row whose schema it does not recognise rather than mis-decoding it', () => {
    const parsed = parseHistoryResponse({
      data: {
        attestations: [
          { id: `0x${'33'.repeat(32)}`, schemaId: `0x${'cd'.repeat(32)}`, revocationTime: 0, timeCreated: 100, data: singleData },
        ],
      },
    })
    expect(parsed.status === 'ok' && parsed.attestations).toEqual([])
  })
})
