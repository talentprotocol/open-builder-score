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
