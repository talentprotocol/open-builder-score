import { describe, it, expect, vi } from 'vitest'
import { basenameReverseNode, resolveDisplayNames, type NameLookupDeps } from '@/lib/names'

const JESSE = '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9' as const
const OTHER = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const

function deps(overrides: Partial<NameLookupDeps> = {}): NameLookupDeps {
  return {
    basenameReverse: async (addresses) => addresses.map(() => null),
    basenameForward: async (names) => names.map(() => null),
    ensName: async () => null,
    ...overrides,
  }
}

describe('basenameReverseNode', () => {
  it('derives the ENSIP-19 Base reverse node (checked against a live basename)', () => {
    expect(basenameReverseNode(JESSE)).toBe(
      '0x32ac9b4c5ef8d4742ed765a7e069ea31f043ee8d666b9009d74b2de6d02ff182',
    )
  })
})

describe('resolveDisplayNames', () => {
  it('returns a forward-verified basename, keyed by lowercased address', async () => {
    const result = await resolveDisplayNames(
      [JESSE],
      deps({
        basenameReverse: async () => ['jesse.base.eth'],
        basenameForward: async () => [JESSE],
      }),
    )
    expect(result.get(JESSE.toLowerCase())).toBe('jesse.base.eth')
  })

  it('drops a basename whose forward resolution points elsewhere', async () => {
    const result = await resolveDisplayNames(
      [JESSE],
      deps({
        basenameReverse: async () => ['vitalik.base.eth'],
        basenameForward: async () => [OTHER],
        ensName: async () => 'real.eth',
      }),
    )
    expect(result.get(JESSE.toLowerCase())).toBe('real.eth')
  })

  it('falls back to ENS when there is no basename', async () => {
    const result = await resolveDisplayNames([OTHER], deps({ ensName: async () => 'other.eth' }))
    expect(result.get(OTHER.toLowerCase())).toBe('other.eth')
  })

  it('only queries ENS for addresses without a verified basename', async () => {
    const ensName = vi.fn<NameLookupDeps['ensName']>(async () => null)
    await resolveDisplayNames(
      [JESSE, OTHER],
      deps({
        basenameReverse: async (addresses) =>
          addresses.map((a) => (a.toLowerCase() === JESSE.toLowerCase() ? 'jesse.base.eth' : null)),
        basenameForward: async () => [JESSE],
        ensName,
      }),
    )
    expect(ensName).toHaveBeenCalledTimes(1)
    expect(ensName.mock.calls[0][0]).toBe(OTHER)
  })

  it('leaves an address unnamed when every lookup fails', async () => {
    const result = await resolveDisplayNames(
      [OTHER],
      deps({
        basenameReverse: async () => {
          throw new Error('rpc down')
        },
        ensName: async () => {
          throw new Error('rpc down')
        },
      }),
    )
    expect(result.get(OTHER.toLowerCase())).toBeUndefined()
  })

  it('dedupes addresses case-insensitively', async () => {
    const basenameReverse = vi.fn(async (addresses: readonly `0x${string}`[]) =>
      addresses.map(() => 'jesse.base.eth'),
    )
    await resolveDisplayNames(
      [JESSE, JESSE.toLowerCase() as `0x${string}`],
      deps({ basenameReverse, basenameForward: async () => [JESSE] }),
    )
    expect(basenameReverse.mock.calls[0][0]).toHaveLength(1)
  })
})
