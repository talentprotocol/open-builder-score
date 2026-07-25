import { describe, it, expect } from 'vitest'
import { gatherInputs } from '@/lib/orchestrate'
import type { CredentialInput } from '@/lib/types'

const ok = (n: number): CredentialInput => ({ status: 'ok', accounts: [n] })

describe('gatherInputs', () => {
  it('merges all four sources under the right slugs', async () => {
    const { inputs, baseBlockNumber } = await gatherInputs('0x0000000000000000000000000000000000000001', 'octocat', {
      chains: async () => ({
        values: { eth_global_hacker: ok(1), talent_vault: ok(2) },
        baseBlockNumber: 123n,
      }),
      github: async () => ({ github_followers: ok(170) }),
      speedrun: async () => ok(4),
      verifiedBuilder: async () => ok(2),
    })
    expect(inputs.values.eth_global_hacker).toEqual(ok(1))
    expect(inputs.values.github_followers).toEqual(ok(170))
    expect(inputs.values.buidl_guidl_speedrun_ethereum).toEqual(ok(4))
    expect(inputs.values.talent_protocol_verified_builder).toEqual(ok(2))
    expect(baseBlockNumber).toBe(123n)
    expect(inputs.computedAt).toBeGreaterThan(1_750_000_000)
  })

  it('captures computedAt once, in unix seconds', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { inputs } = await gatherInputs('0x0000000000000000000000000000000000000001', null, {
      chains: async () => ({ values: {}, baseBlockNumber: null }),
      github: async () => ({}),
      speedrun: async () => ok(0),
      verifiedBuilder: async () => ok(0),
    })
    expect(inputs.computedAt).toBeGreaterThanOrEqual(before)
    expect(inputs.computedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })

  it('reports each source as it settles', async () => {
    const settled: string[] = []
    const ok = { status: 'ok' as const, accounts: [0] }
    await gatherInputs(
      '0x0000000000000000000000000000000000000001',
      null,
      {
        chains: async () => ({ values: {}, baseBlockNumber: null }),
        github: async () => ({}),
        speedrun: async () => ok,
        verifiedBuilder: async () => ok,
      },
      (source) => settled.push(source),
    )
    expect([...settled].sort()).toEqual(['chains', 'github', 'speedrun', 'verifiedBuilder'])
  })
})
