import { describe, it, expect } from 'vitest'
import { computeSchemaUid, ATTEST_SCHEMA, ATTEST_SCHEMA_UID } from '@/lib/eas'

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
