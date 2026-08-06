import { describe, it, expect } from 'vitest'
import { encodeAbiParameters } from 'viem'
import {
  fetchLatestAttestations,
  LATEST_QUERY,
  LATEST_TAKE,
  parseLatestResponse,
} from '@/lib/latest'
import { ATTEST_AGGREGATE_SCHEMA_UID } from '@/lib/eas'
import specJson from '../spec/spec.json'
import type { Spec } from '@/lib/types'

const spec = specJson as Spec
const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const UID = `0x${'ab'.repeat(32)}`

// v3 aggregate blob: the 12 fields of ATTEST_AGGREGATE_SCHEMA, in order.
function encodeAggregateData(score: number, specVersion: string = spec.version): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'address' },
      { type: 'address[]' },
      { type: 'bytes[]' },
      { type: 'bytes' },
      { type: 'uint64' },
      { type: 'string' },
      { type: 'uint16' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'string' },
      { type: 'string[]' },
    ],
    [
      specVersion,
      WALLET,
      ['0x1563915e194D8CfBA1943570603F7606A3115508', '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'],
      [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
      '0x',
      1784975800n,
      'octocat',
      score,
      1784975866n,
      49093260n,
      'https://talentprotocol.com/verify/wallet/x',
      ['talent_token_launched'],
    ],
  )
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: UID,
    recipient: WALLET,
    timeCreated: 1784975900,
    data: encodeAggregateData(131),
    ...overrides,
  }
}

describe('LATEST_QUERY', () => {
  it('asks for the one schema, live rows only, newest first', () => {
    expect(LATEST_QUERY).toMatch(/schemaId:\s*\{\s*equals:\s*\$schema_id\s*\}/)
    expect(LATEST_QUERY).toMatch(/revocationTime:\s*\{\s*equals:\s*0\s*\}/)
    expect(LATEST_QUERY).toMatch(/orderBy:\s*\[\s*\{\s*timeCreated:\s*desc\s*\}\s*\]/)
    expect(LATEST_QUERY).toMatch(/take:\s*\$take/)
    // A global feed is meaningless without knowing whose score each row is.
    expect(LATEST_QUERY).toMatch(/^\s*recipient\s*$/m)
  })
})

describe('parseLatestResponse', () => {
  it('decodes rows into latest-attestation summaries', () => {
    const result = parseLatestResponse({ data: { attestations: [entry()] } })
    expect(result).toEqual({
      status: 'ok',
      attestations: [
        {
          uid: UID,
          recipient: WALLET,
          score: 131,
          specVersion: spec.version,
          walletCount: 3,
          timeCreated: 1784975900,
        },
      ],
    })
  })
  it('skips undecodable rows but keeps good ones', () => {
    const result = parseLatestResponse({
      data: { attestations: [entry({ data: '0x1234' }), entry()] },
    })
    expect(result.status === 'ok' && result.attestations).toHaveLength(1)
  })
  it('returns ok with an empty list when every row is undecodable', () => {
    const result = parseLatestResponse({
      data: { attestations: [entry({ data: '0x1234' }), entry({ data: '0xdead' })] },
    })
    expect(result).toEqual({ status: 'ok', attestations: [] })
  })
  it('skips rows missing a recipient', () => {
    const result = parseLatestResponse({
      data: { attestations: [entry({ recipient: undefined })] },
    })
    expect(result).toEqual({ status: 'ok', attestations: [] })
  })
  it('maps junk shapes to error', () => {
    expect(parseLatestResponse(null).status).toBe('error')
    expect(parseLatestResponse({ data: {} }).status).toBe('error')
  })
})

describe('fetchLatestAttestations', () => {
  it('posts the aggregate schema UID and page size, and parses the list', async () => {
    let body = ''
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ data: { attestations: [entry()] } }), { status: 200 })
    }) as typeof fetch
    const result = await fetchLatestAttestations(fakeFetch)
    expect(result.status).toBe('ok')
    expect(body).toContain(ATTEST_AGGREGATE_SCHEMA_UID)
    expect(body).toContain(LATEST_QUERY.slice(0, 20))
    expect(body).toContain(`"take":${LATEST_TAKE}`)
  })
  it('maps HTTP and network failures to error', async () => {
    const httpFail = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect((await fetchLatestAttestations(httpFail)).status).toBe('error')
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await fetchLatestAttestations(netFail)).status).toBe('error')
  })
})
