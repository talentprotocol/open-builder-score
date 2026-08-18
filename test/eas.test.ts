import { describe, it, expect } from 'vitest'
import { parseAbiParameters, decodeAbiParameters } from 'viem'
import {
  computeSchemaUid,
  ATTEST_SCHEMA,
  ATTEST_SCHEMA_UID,
  ATTEST_AGGREGATE_SCHEMA,
  ATTEST_AGGREGATE_SCHEMA_UID,
  ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID,
} from '@/lib/eas'
import { encodeAggregateAttestationData } from '@/lib/eas-attest'

describe('schema UID', () => {
  it('is deterministic keccak256(schema ++ resolver ++ revocable)', () => {
    // EAS SchemaRegistry: uid = keccak256(abi.encodePacked(schema, resolver, revocable))
    const uid = computeSchemaUid(
      ATTEST_SCHEMA,
      '0x0000000000000000000000000000000000000000',
      true,
    )
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)
    expect(uid).toBe(ATTEST_SCHEMA_UID)
  })

  it('matches the schema registered on Base Sepolia (schema #2265, 2026-07-25)', () => {
    // Golden pin: verified on-chain against SchemaRegistry.getSchema — a change to
    // ATTEST_SCHEMA or computeSchemaUid that breaks this line breaks attestation.
    expect(ATTEST_SCHEMA_UID).toBe(
      '0x38b1a4ab5bee04789565591b11646eb0f5269096f65ef0b24e817f2b6168d1cd',
    )
  })

  it('changes when revocable changes', () => {
    const revocable = computeSchemaUid(ATTEST_SCHEMA, '0x0000000000000000000000000000000000000000', true)
    const irrevocable = computeSchemaUid(ATTEST_SCHEMA, '0x0000000000000000000000000000000000000000', false)
    expect(revocable).not.toBe(irrevocable)
  })

  it('uses the README-proposed field list', () => {
    expect(ATTEST_SCHEMA).toBe(
      'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number',
    )
  })
})

describe('aggregate schema UID', () => {
  it('is deterministic keccak256(schema ++ resolver ++ revocable)', () => {
    const uid = computeSchemaUid(
      ATTEST_AGGREGATE_SCHEMA,
      '0x0000000000000000000000000000000000000000',
      true,
    )
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)
    expect(uid).toBe(ATTEST_AGGREGATE_SCHEMA_UID)
  })

  it('matches the schema registered on Base Sepolia (schema #2308, 2026-08-05)', () => {
    // Golden pin: verified on-chain against the Registered event and easscan
    // (tx 0xa8d87dff68fd14d0c7c43c8a0ddd23ed156ce738f6f9a48c6245408ed0831c76).
    expect(ATTEST_AGGREGATE_SCHEMA_UID).toBe(
      '0x9bba0ee6d4f74ab182e84e86c5c873ac5a37ef97f98ff7750f5dec7c3ac1edc7',
    )
  })

  it('is a different schema from the single-wallet one', () => {
    expect(ATTEST_AGGREGATE_SCHEMA_UID).not.toBe(ATTEST_SCHEMA_UID)
  })

  it('carries the wallet set, its proofs, the recipient proof slot, and the proof anchor', () => {
    expect(ATTEST_AGGREGATE_SCHEMA).toBe(
      'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,bytes recipient_ownership_proof,uint64 proofs_issued_at,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges',
    )
  })

  it('decodes with viem in the same field order the eas-sdk encodes', () => {
    // The guard that the SchemaEncoder (attest) and decodeAbiParameters (verify)
    // can never drift apart.
    const params = parseAbiParameters(ATTEST_AGGREGATE_SCHEMA)
    expect(params.map((p) => [p.name, p.type])).toEqual([
      ['spec_version', 'string'],
      ['wallet', 'address'],
      ['extra_wallets', 'address[]'],
      ['ownership_proofs', 'bytes[]'],
      ['recipient_ownership_proof', 'bytes'],
      ['proofs_issued_at', 'uint64'],
      ['github_handle', 'string'],
      ['score', 'uint16'],
      ['computed_at', 'uint64'],
      ['block_number', 'uint64'],
      ['verify_url', 'string'],
      ['badges', 'string[]'],
    ])
  })

  it('keeps the demoted verify_url schema pinned — real attestations decode against it', () => {
    expect(ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID).toBe(
      '0x01d83b22aca3881b6673513b0e29fec6659a7def03c69fa41c55a16bcaf192a2',
    )
  })
})

describe('encodeAggregateAttestationData', () => {
  const params = {
    specVersion: '0.2.0',
    wallet: '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as `0x${string}`,
    extraWallets: [
      '0x1563915e194D8CfBA1943570603F7606A3115508',
      '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
    ] as `0x${string}`[],
    ownershipProofs: [`0x${'11'.repeat(65)}`, `0x${'ab'.repeat(200)}`] as `0x${string}`[],
    recipientProof: '0x' as `0x${string}`,
    proofsIssuedAt: 1784975866,
    badges: ['talent_token_launched', 'build_contributor'],
    githubHandle: 'octocat',
    score: 131,
    computedAt: 1784975866,
    blockNumber: 34567890n,
  }

  it('round-trips through the viem decoder the verify path uses', () => {
    const data = encodeAggregateAttestationData(params)
    const decoded = decodeAbiParameters(parseAbiParameters(ATTEST_AGGREGATE_SCHEMA), data)
    expect(decoded).toEqual([
      '0.2.0',
      params.wallet,
      params.extraWallets,
      params.ownershipProofs,
      '0x',
      1784975866n,
      'octocat',
      131,
      1784975866n,
      34567890n,
      'https://talentprotocol.com/verify/wallet/0x33041027dd8F4dC82B6e825FB37ADf8f15d44053',
      ['talent_token_launched', 'build_contributor'],
    ])
  })

  it('encodes a null handle as the empty string, like the single-wallet schema', () => {
    const data = encodeAggregateAttestationData({ ...params, githubHandle: null })
    expect(decodeAbiParameters(parseAbiParameters(ATTEST_AGGREGATE_SCHEMA), data)[6]).toBe('')
  })

  it('refuses to encode when a wallet has no matching proof slot', () => {
    expect(() =>
      encodeAggregateAttestationData({ ...params, ownershipProofs: [params.ownershipProofs[0]] }),
    ).toThrow(/proof/i)
  })

  it('refuses to encode an aggregate with no extra wallets', () => {
    expect(() =>
      encodeAggregateAttestationData({ ...params, extraWallets: [], ownershipProofs: [] }),
    ).toThrow(/extra wallet/i)
  })

  it('encodes a real recipient proof when an extra is the sender', () => {
    const recipientProof = `0x${'cd'.repeat(65)}` as `0x${string}`
    const data = encodeAggregateAttestationData({
      ...params,
      recipientProof,
      ownershipProofs: ['0x', params.ownershipProofs[1]],
    })
    const decoded = decodeAbiParameters(parseAbiParameters(ATTEST_AGGREGATE_SCHEMA), data)
    expect(decoded[4]).toBe(recipientProof)
    expect(decoded[3]).toEqual(['0x', params.ownershipProofs[1]])
  })
})
