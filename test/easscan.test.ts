import { describe, it, expect } from 'vitest'
import { countDistinctAttesters, VERIFIED_BUILDER_QUERY } from '@/lib/easscan'

const response = (attestations: unknown) => ({ data: { attestations } })

describe('countDistinctAttesters', () => {
  it('unions attesters across networks and dedupes', () => {
    expect(
      countDistinctAttesters([
        response([
          { attester: '0xAAA0000000000000000000000000000000000001', revocationTime: 0 },
          { attester: '0xAAA0000000000000000000000000000000000002', revocationTime: null },
        ]),
        response([
          { attester: '0xAAA0000000000000000000000000000000000001', revocationTime: 0 }, // dup on other chain
          { attester: '0xAAA0000000000000000000000000000000000003', revocationTime: 0 },
        ]),
      ]),
    ).toBe(3)
  })

  it('excludes revoked attestations (nonzero revocationTime)', () => {
    expect(
      countDistinctAttesters([
        response([
          { attester: '0xAAA0000000000000000000000000000000000001', revocationTime: 1_700_000_000 },
          { attester: '0xAAA0000000000000000000000000000000000002', revocationTime: 0 },
        ]),
      ]),
    ).toBe(1)
  })

  it('returns null on a malformed response', () => {
    expect(countDistinctAttesters([{ errors: [{ message: 'boom' }] }])).toBeNull()
    expect(countDistinctAttesters([response('not-an-array')])).toBeNull()
  })

  it('counts zero attestations as 0', () => {
    expect(countDistinctAttesters([response([]), response([])])).toBe(0)
  })
})

describe('VERIFIED_BUILDER_QUERY', () => {
  it('filters by recipient and schemaId only (production parity)', () => {
    expect(VERIFIED_BUILDER_QUERY).toContain('recipient')
    expect(VERIFIED_BUILDER_QUERY).toContain('schemaId')
    expect(VERIFIED_BUILDER_QUERY).not.toContain('attester:')
  })
})
