import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, zeroAddress } from 'viem'
import {
  ATTESTATION_QUERY,
  decodeAttestationData,
  fetchAttestation,
  isAttestationUid,
  parseAttestationResponse,
  scoreVerdict,
  validateAttestation,
  type OnchainAttestation,
} from '@/lib/verify'
import { ATTEST_SCHEMA_UID } from '@/lib/eas'
import specJson from '../spec/spec.json'
import type { ScoreResult, Spec } from '@/lib/types'

const spec = specJson as Spec

const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const UID = `0x${'ab'.repeat(32)}`

function encodeData(overrides: Partial<{
  specVersion: string
  wallet: `0x${string}`
  githubHandle: string
  score: number
  computedAt: bigint
  blockNumber: bigint
}> = {}): `0x${string}` {
  const v = {
    specVersion: spec.version,
    wallet: WALLET,
    githubHandle: 'octocat',
    score: 103,
    computedAt: 1784975866n,
    blockNumber: 49093260n,
    ...overrides,
  }
  return encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'address' },
      { type: 'string' },
      { type: 'uint16' },
      { type: 'uint64' },
      { type: 'uint64' },
    ],
    [v.specVersion, v.wallet, v.githubHandle, v.score, v.computedAt, v.blockNumber],
  )
}

function attestation(overrides: Partial<OnchainAttestation> = {}): OnchainAttestation {
  return {
    uid: UID,
    schemaId: ATTEST_SCHEMA_UID,
    recipient: WALLET,
    attester: WALLET,
    revocationTime: 0,
    timeCreated: 1784975900,
    data: encodeData(),
    ...overrides,
  }
}

function scoreResult(total: number, complete: boolean): ScoreResult {
  return { total, maxTotal: 257, perCredential: [], complete }
}

describe('isAttestationUid', () => {
  it('accepts 0x + 64 hex chars', () => {
    expect(isAttestationUid(UID)).toBe(true)
  })
  it('rejects wrong lengths and non-hex', () => {
    expect(isAttestationUid('0x1234')).toBe(false)
    expect(isAttestationUid(`0x${'gg'.repeat(32)}`)).toBe(false)
    expect(isAttestationUid(WALLET)).toBe(false)
  })
})

describe('decodeAttestationData', () => {
  it('round-trips the schema fields', () => {
    const decoded = decodeAttestationData(encodeData())
    expect(decoded).toEqual({
      specVersion: spec.version,
      wallet: WALLET,
      githubHandle: 'octocat',
      score: 103,
      computedAt: 1784975866,
      blockNumber: 49093260n,
    })
  })
  it('maps an empty github handle to null', () => {
    expect(decodeAttestationData(encodeData({ githubHandle: '' }))?.githubHandle).toBeNull()
  })
  it('returns null on undecodable data', () => {
    expect(decodeAttestationData('0x1234')).toBeNull()
  })
})

describe('validateAttestation', () => {
  it('passes a clean attestation', () => {
    const att = attestation()
    expect(validateAttestation(att, decodeAttestationData(att.data))).toEqual([])
  })
  it('flags a foreign schema', () => {
    const att = attestation({ schemaId: `0x${'00'.repeat(32)}` })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('different schema'))).toBe(true)
  })
  it('flags a revoked attestation', () => {
    const att = attestation({ revocationTime: 1784976000 })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('revoked'))).toBe(true)
  })
  it('flags undecodable data', () => {
    const att = attestation({ data: '0x1234' })
    expect(validateAttestation(att, null).some((p) => p.includes('decode'))).toBe(true)
  })
  it('flags recipient / wallet mismatch', () => {
    const att = attestation({ recipient: zeroAddress })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('recipient'))).toBe(true)
  })
  it('flags a spec version mismatch', () => {
    const att = attestation({ data: encodeData({ specVersion: '9.9.9' }) })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('spec'))).toBe(true)
  })
})

describe('scoreVerdict', () => {
  it('match when complete and equal', () => {
    expect(scoreVerdict(103, scoreResult(103, true))).toBe('match')
  })
  it('diverged when complete and different', () => {
    expect(scoreVerdict(103, scoreResult(90, true))).toBe('diverged')
  })
  it('incomplete when any source was unavailable', () => {
    expect(scoreVerdict(103, scoreResult(103, false))).toBe('incomplete')
  })
})

describe('parseAttestationResponse', () => {
  it('finds an attestation', () => {
    const raw = { data: { attestation: { id: UID, schemaId: ATTEST_SCHEMA_UID, recipient: WALLET, attester: WALLET, revocationTime: 0, timeCreated: 1, data: '0x' } } }
    const result = parseAttestationResponse(raw)
    expect(result.status).toBe('found')
  })
  it('maps null attestation to not_found', () => {
    expect(parseAttestationResponse({ data: { attestation: null } }).status).toBe('not_found')
  })
  it('maps junk shapes to error', () => {
    expect(parseAttestationResponse(null).status).toBe('error')
    expect(parseAttestationResponse({ data: {} }).status).toBe('error')
    expect(parseAttestationResponse({ data: { attestation: { id: 42 } } }).status).toBe('error')
  })
})

describe('fetchAttestation', () => {
  it('posts the query and parses a found attestation', async () => {
    let captured: { url: string; body: string } | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body) }
      return new Response(
        JSON.stringify({ data: { attestation: { id: UID, schemaId: ATTEST_SCHEMA_UID, recipient: WALLET, attester: WALLET, revocationTime: 0, timeCreated: 1, data: '0x' } } }),
        { status: 200 },
      )
    }) as typeof fetch
    const result = await fetchAttestation(UID, fakeFetch)
    expect(result.status).toBe('found')
    expect(captured!.body).toContain(UID)
    expect(captured!.body).toContain(ATTESTATION_QUERY.slice(0, 20))
  })
  it('maps HTTP errors to error', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect((await fetchAttestation(UID, fakeFetch)).status).toBe('error')
  })
  it('maps network failures to error', async () => {
    const fakeFetch = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await fetchAttestation(UID, fakeFetch)).status).toBe('error')
  })
})
