import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, zeroAddress } from 'viem'
import {
  ATTESTATION_QUERY,
  classifyAttestation,
  decodeAttestationData,
  fetchAttestation,
  isAttestationUid,
  isAttesterInSet,
  isSelfAttested,
  parseAttestationResponse,
  scoreVerdict,
  validateAttestation,
  verifyAttestationOwnership,
  type OnchainAttestation,
} from '@/lib/verify'
import { OWNERSHIP_PROOF_TTL_SECONDS } from '@/lib/ownership'
import {
  ATTEST_SCHEMA_UID,
  ATTEST_AGGREGATE_SCHEMA_UID,
  ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID,
  ATTEST_AGGREGATE_LEGACY_SCHEMA_UID,
} from '@/lib/eas'
import { encodeAggregateAttestationData } from '@/lib/eas-attest'
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
    const decoded = decodeAttestationData(encodeData(), ATTEST_SCHEMA_UID)
    expect(decoded).toEqual({
      version: 1,
      specVersion: spec.version,
      wallet: WALLET,
      extraWallets: [],
      ownershipProofs: [],
      recipientProof: null,
      proofsIssuedAt: null,
      verifyUrl: null,
      badges: [],
      githubHandle: 'octocat',
      score: 103,
      computedAt: 1784975866,
      blockNumber: 49093260n,
    })
  })
  it('maps an empty github handle to null', () => {
    expect(decodeAttestationData(encodeData({ githubHandle: '' }), ATTEST_SCHEMA_UID)?.githubHandle).toBeNull()
  })
  it('returns null on undecodable data', () => {
    expect(decodeAttestationData('0x1234', ATTEST_SCHEMA_UID)).toBeNull()
  })
})

describe('validateAttestation', () => {
  it('passes a clean attestation', () => {
    const att = attestation()
    expect(validateAttestation(att, decodeAttestationData(att.data, att.schemaId))).toEqual([])
  })
  it('flags a foreign schema', () => {
    const att = attestation({ schemaId: `0x${'00'.repeat(32)}` })
    const problems = validateAttestation(att, decodeAttestationData(att.data, att.schemaId))
    expect(problems.some((p) => p.includes('different schema'))).toBe(true)
  })
  it('flags undecodable data', () => {
    const att = attestation({ data: '0x1234' })
    expect(validateAttestation(att, null).some((p) => p.includes('decode'))).toBe(true)
  })
  it('flags recipient / wallet mismatch', () => {
    const att = attestation({ recipient: zeroAddress })
    const problems = validateAttestation(att, decodeAttestationData(att.data, att.schemaId))
    expect(problems.some((p) => p.includes('recipient'))).toBe(true)
  })
})

describe('classifyAttestation', () => {
  it('classifies a clean attestation as ok', () => {
    const att = attestation()
    expect(classifyAttestation(att, decodeAttestationData(att.data, att.schemaId)).kind).toBe('ok')
  })
  it('classifies a revoked-only attestation as revoked', () => {
    const att = attestation({ revocationTime: 1784976000 })
    expect(classifyAttestation(att, decodeAttestationData(att.data, att.schemaId)).kind).toBe('revoked')
  })
  it('classifies a spec-version override as spec_mismatch', () => {
    const att = attestation({ data: encodeData({ specVersion: '9.9.9' }) })
    expect(classifyAttestation(att, decodeAttestationData(att.data, att.schemaId)).kind).toBe('spec_mismatch')
  })
  it('classifies a foreign schema as malformed even when also revoked (precedence)', () => {
    const att = attestation({ schemaId: `0x${'00'.repeat(32)}`, revocationTime: 1784976000 })
    expect(classifyAttestation(att, decodeAttestationData(att.data, att.schemaId)).kind).toBe('malformed')
  })
})

describe('isSelfAttested', () => {
  const decoded = () => decodeAttestationData(encodeData(), ATTEST_SCHEMA_UID)!

  it('is true when the attester is the scored wallet, whatever the casing', () => {
    expect(isSelfAttested(attestation(), decoded())).toBe(true)
    expect(
      isSelfAttested(attestation({ attester: WALLET.toLowerCase() as `0x${string}` }), decoded()),
    ).toBe(true)
  })
  it('is false when someone else attested the score', () => {
    expect(isSelfAttested(attestation({ attester: zeroAddress }), decoded())).toBe(false)
  })
  it('is false rather than throwing on a malformed attester', () => {
    expect(isSelfAttested(attestation({ attester: 'not-an-address' }), decoded())).toBe(false)
  })
  it('does not affect the score verdict or classification', () => {
    // The two facts are independent: a score attested by a third party still
    // recomputes correctly, and pre-gate attestations must not read as malformed.
    const thirdParty = attestation({ attester: zeroAddress })
    expect(classifyAttestation(thirdParty, decoded()).kind).toBe('ok')
    expect(scoreVerdict(103, scoreResult(103, true))).toBe('match')
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
  it('surfaces GraphQL-level errors', () => {
    const result = parseAttestationResponse({ errors: [{ message: 'boom' }], data: null })
    expect(result.status).toBe('error')
    expect(result.status === 'error' && result.reason).toContain('boom')
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

const EXTRA_A = '0x1563915e194D8CfBA1943570603F7606A3115508' as const
const EXTRA_B = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A' as const

function encodeAggregateData(
  overrides: Partial<{
    specVersion: string
    wallet: `0x${string}`
    extraWallets: `0x${string}`[]
    ownershipProofs: `0x${string}`[]
    githubHandle: string
    score: number
    computedAt: bigint
    blockNumber: bigint
    verifyUrl: string
    badges: string[]
  }> = {},
): `0x${string}` {
  const v = {
    specVersion: spec.version,
    wallet: WALLET,
    extraWallets: [EXTRA_A, EXTRA_B] as `0x${string}`[],
    ownershipProofs: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`] as `0x${string}`[],
    githubHandle: 'octocat',
    score: 103,
    computedAt: 1784975866n,
    blockNumber: 49093260n,
    verifyUrl: 'https://talentprotocol.com/verify/wallet/0xabc',
    badges: ['talent_token_launched'],
    ...overrides,
  }
  return encodeAbiParameters(
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
      v.specVersion,
      v.wallet,
      v.extraWallets,
      v.ownershipProofs,
      v.githubHandle,
      v.score,
      v.computedAt,
      v.blockNumber,
      v.verifyUrl,
      v.badges,
    ],
  )
}

const aggregateAttestation = (overrides: Partial<OnchainAttestation> = {}): OnchainAttestation => ({
  ...attestation(),
  schemaId: ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID,
  data: encodeAggregateData(),
  ...overrides,
})

// v3: adds the recipient proof slot and the shared proofs_issued_at anchor.
const dataV3 = encodeAggregateAttestationData({
  specVersion: spec.version,
  wallet: WALLET,
  extraWallets: [EXTRA_A, EXTRA_B],
  ownershipProofs: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
  recipientProof: '0x' as `0x${string}`,
  proofsIssuedAt: 1784975866,
  githubHandle: 'octocat',
  score: 103,
  computedAt: 1784975866,
  blockNumber: 49093260n,
  badges: ['talent_token_launched'],
})

describe('decodeAttestationData — schema dispatch', () => {
  it('decodes a single-wallet record with empty wallet-set fields', () => {
    const decoded = decodeAttestationData(encodeData(), ATTEST_SCHEMA_UID)
    expect(decoded).toMatchObject({ version: 1, wallet: WALLET, extraWallets: [], ownershipProofs: [] })
  })

  it('carries a verify URL and the earned badge slugs', () => {
    const att = aggregateAttestation()
    const decoded = decodeAttestationData(att.data, att.schemaId)!
    expect(decoded.verifyUrl).toBe('https://talentprotocol.com/verify/wallet/0xabc')
    expect(decoded.badges).toEqual(['talent_token_launched'])
  })

  it('decodes an aggregate record with its wallet set and proofs', () => {
    const decoded = decodeAttestationData(encodeAggregateData(), ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID)
    expect(decoded).toMatchObject({
      version: 2,
      wallet: WALLET,
      extraWallets: [EXTRA_A, EXTRA_B],
      score: 103,
    })
    expect(decoded?.ownershipProofs).toHaveLength(2)
  })

  it('returns null for an unknown schema rather than guessing', () => {
    expect(decodeAttestationData(encodeData(), `0x${'cd'.repeat(32)}`)).toBeNull()
  })

  it('returns null when single-wallet bytes are read as an aggregate', () => {
    expect(decodeAttestationData(encodeData(), ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID)).toBeNull()
  })
})

describe('validateAttestation — aggregate structure', () => {
  const problemsFor = (over: Parameters<typeof encodeAggregateData>[0]) => {
    const att = aggregateAttestation({ data: encodeAggregateData(over) })
    return validateAttestation(att, decodeAttestationData(att.data, att.schemaId))
  }

  it('accepts a well-formed aggregate', () => {
    expect(problemsFor({})).toEqual([])
  })

  it('rejects a wallet with no matching proof', () => {
    expect(problemsFor({ ownershipProofs: [`0x${'11'.repeat(65)}`] }).join(' ')).toMatch(/proof/i)
  })

  it('rejects an aggregate carrying no extra wallets', () => {
    expect(problemsFor({ extraWallets: [], ownershipProofs: [] }).join(' ')).toMatch(/extra wallet/i)
  })

  it('rejects extras that are not strictly ascending, which also catches duplicates', () => {
    expect(problemsFor({ extraWallets: [EXTRA_B, EXTRA_A] }).join(' ')).toMatch(/ascending/i)
    expect(problemsFor({ extraWallets: [EXTRA_A, EXTRA_A] }).join(' ')).toMatch(/ascending/i)
  })

  it('rejects an extra that repeats the recipient', () => {
    expect(problemsFor({ extraWallets: [WALLET, EXTRA_B] }).join(' ')).toMatch(/recipient/i)
  })

  it('rejects more extras than the wallet cap allows', () => {
    const many = [EXTRA_A, EXTRA_B, '0x2000000000000000000000000000000000000000',
      '0x3000000000000000000000000000000000000000',
      '0x4000000000000000000000000000000000000000'] as `0x${string}`[]
    expect(
      problemsFor({ many: undefined, extraWallets: many, ownershipProofs: many.map(() => `0x${'11'.repeat(65)}` as `0x${string}`) } as never).join(' '),
    ).toMatch(/at most/i)
  })
})

describe('ownership and score correctness stay independent facts', () => {
  it('classifies an aggregate with unusable proofs as ok', () => {
    const att = aggregateAttestation({
      data: encodeAggregateData({ ownershipProofs: [`0x${'00'.repeat(65)}`, `0x${'00'.repeat(65)}`] }),
    })
    const decoded = decodeAttestationData(att.data, att.schemaId)
    expect(classifyAttestation(att, decoded).kind).toBe('ok')
  })

  it('checks self-attestation against the recipient wallet', () => {
    const att = aggregateAttestation()
    const decoded = decodeAttestationData(att.data, att.schemaId)!
    expect(isSelfAttested(att, decoded)).toBe(true)
    expect(isSelfAttested({ ...att, attester: EXTRA_A }, decoded)).toBe(false)
  })
})

describe('superseded aggregate schema stays verifiable', () => {
  // #2305 carried verify_url_prefix instead of score_url + badges. Real
  // attestations exist against it, and the repo's rule is that older
  // attestations keep verifying — same reason v1 was never retired.
  const legacyData = encodeAbiParameters(
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
    ],
    [
      spec.version,
      WALLET,
      [EXTRA_A],
      [`0x${'11'.repeat(65)}`],
      'octocat',
      81,
      1784975866n,
      49093260n,
      'https://talentprotocol.com/verify/',
    ],
  )

  it('decodes a #2305 record, with no score URL and no badges', () => {
    const decoded = decodeAttestationData(legacyData, ATTEST_AGGREGATE_LEGACY_SCHEMA_UID)
    expect(decoded).toMatchObject({
      version: 2,
      wallet: WALLET,
      extraWallets: [EXTRA_A],
      score: 81,
      verifyUrl: null,
      badges: [],
    })
  })

  it('classifies it as ok, so the ownership proof still shows', () => {
    const att = attestation({ schemaId: ATTEST_AGGREGATE_LEGACY_SCHEMA_UID, data: legacyData })
    expect(classifyAttestation(att, decodeAttestationData(att.data, att.schemaId)).kind).toBe('ok')
  })
})

describe('v3 aggregate decode', () => {
  it('surfaces the recipient proof and the anchor', () => {
    const decoded = decodeAttestationData(dataV3, ATTEST_AGGREGATE_SCHEMA_UID)
    expect(decoded?.recipientProof).toBe('0x')
    expect(decoded?.proofsIssuedAt).toBe(1784975866)
    expect(decoded?.version).toBe(2)
  })

  it('marks every legacy aggregate decode with a null anchor', () => {
    const decodedLegacy = decodeAttestationData(
      encodeAggregateData(),
      ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID,
    )
    expect(decodedLegacy?.recipientProof).toBeNull()
    expect(decodedLegacy?.proofsIssuedAt).toBeNull()
  })
})

describe('isAttesterInSet', () => {
  const att = aggregateAttestation({ schemaId: ATTEST_AGGREGATE_SCHEMA_UID, data: dataV3 })
  const decoded = decodeAttestationData(att.data, att.schemaId)!

  it('accepts the recipient, any extra, and rejects outsiders', () => {
    expect(isAttesterInSet({ ...att, attester: decoded.wallet }, decoded)).toBe(true)
    expect(isAttesterInSet({ ...att, attester: decoded.extraWallets[0] }, decoded)).toBe(true)
    expect(
      isAttesterInSet({ ...att, attester: '0x000000000000000000000000000000000000dEaD' }, decoded),
    ).toBe(false)
  })
})

// Ownership is checkable whenever the wallet set and proofs decode — it does
// not depend on the spec version being comparable. This dispatcher is what
// both the recomputed and the not-comparable verify paths share.
describe('verifyAttestationOwnership', () => {
  const io = { verifyContractSignature: async () => false }

  it('has nothing to check for a single-wallet attestation', async () => {
    const att = attestation()
    const decoded = decodeAttestationData(att.data, att.schemaId)!
    expect(await verifyAttestationOwnership(att, decoded, io)).toEqual([])
  })

  it('checks the full v3 set, recipient included, with the attester exempt', async () => {
    const att = aggregateAttestation({ schemaId: ATTEST_AGGREGATE_SCHEMA_UID, data: dataV3 })
    const decoded = decodeAttestationData(att.data, att.schemaId)!
    const checks = await verifyAttestationOwnership(att, decoded, io)
    // attester === recipient; the extras carry garbage bytes, not signatures.
    expect(checks.map((c) => c.status)).toEqual(['attester', 'invalid', 'invalid'])
  })

  it('anchors the v3 validity window to the attestation time', async () => {
    const att = aggregateAttestation({
      schemaId: ATTEST_AGGREGATE_SCHEMA_UID,
      data: dataV3,
      timeCreated: 1784975866 + OWNERSHIP_PROOF_TTL_SECONDS + 1,
    })
    const decoded = decodeAttestationData(att.data, att.schemaId)!
    const checks = await verifyAttestationOwnership(att, decoded, io)
    expect(checks.map((c) => c.status)).toEqual(['attester', 'expired', 'expired'])
  })

  it('checks only the extras on a legacy aggregate', async () => {
    const att = aggregateAttestation() // verify-url schema: no proofsIssuedAt
    const decoded = decodeAttestationData(att.data, att.schemaId)!
    const checks = await verifyAttestationOwnership(att, decoded, io)
    expect(checks.map((c) => c.wallet)).toEqual([EXTRA_A, EXTRA_B])
  })
})
