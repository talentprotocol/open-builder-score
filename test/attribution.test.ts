import { describe, it, expect } from 'vitest'
import { Attribution } from 'ox/erc8021'
import { BUILDER_CODE, BUILDER_CODE_DATA_SUFFIX } from '@/lib/attribution'

describe('builder code attribution', () => {
  // Golden-pinned like the schema UIDs: these exact bytes land on mainnet
  // calldata, so an ox upgrade that changes the encoding must fail loudly
  // here rather than silently break attribution.
  it('pins the exact suffix bytes appended to transaction calldata', () => {
    expect(BUILDER_CODE_DATA_SUFFIX).toBe(
      '0x62635f38626e35746a336d0b0080218021802180218021802180218021',
    )
  })

  it('round-trips through the ERC-8021 decoder', () => {
    expect(Attribution.fromData(BUILDER_CODE_DATA_SUFFIX)).toEqual({
      codes: [BUILDER_CODE],
      id: 0,
    })
  })
})
