import { describe, it, expect } from 'vitest'
import { gatherInputs, mergeCredentialInputs, gatherMultiInputs } from '@/lib/orchestrate'
import { computeScore } from '@/lib/engine'
import specJson from '../spec/spec.json'
import type { CredentialInput, Spec } from '@/lib/types'

const spec = specJson as Spec

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

describe('mergeCredentialInputs', () => {
  it('concatenates accounts in order', () => {
    expect(mergeCredentialInputs(ok(1), ok(2))).toEqual({ status: 'ok', accounts: [1, 2] })
  })
  it('propagates unavailability from either side', () => {
    const bad: CredentialInput = { status: 'unavailable', reason: 'rpc down' }
    expect(mergeCredentialInputs(bad, ok(2))).toEqual(bad)
    expect(mergeCredentialInputs(ok(1), bad)).toEqual(bad)
  })
})

describe('gatherMultiInputs', () => {
  const A = '0x000000000000000000000000000000000000000a' as `0x${string}`
  const B = '0x000000000000000000000000000000000000000b' as `0x${string}`

  it('fans out per wallet, fetches GitHub once, merges accounts in wallet order', async () => {
    const chainCalls: string[] = []
    const githubCalls: (string | null)[] = []
    const { inputs, baseBlockNumber } = await gatherMultiInputs([A, B], 'octocat', {
      chains: async (address) => {
        chainCalls.push(address)
        return {
          values: { eth_global_hacker: ok(address === A ? 1 : 5), talent_vault: ok(2) },
          baseBlockNumber: address === A ? 111n : 222n,
        }
      },
      github: async (handle) => {
        githubCalls.push(handle)
        return { github_followers: ok(170) }
      },
      speedrun: async (address) => ok(address === A ? 3 : 4),
      verifiedBuilder: async () => ok(1),
    })
    expect([...chainCalls].sort()).toEqual([A, B])
    expect(githubCalls).toEqual(['octocat'])
    expect(inputs.values.eth_global_hacker).toEqual({ status: 'ok', accounts: [1, 5] })
    expect(inputs.values.talent_vault).toEqual({ status: 'ok', accounts: [2, 2] })
    expect(inputs.values.github_followers).toEqual(ok(170))
    expect(inputs.values.buidl_guidl_speedrun_ethereum).toEqual({ status: 'ok', accounts: [3, 4] })
    expect(inputs.values.talent_protocol_verified_builder).toEqual({ status: 'ok', accounts: [1, 1] })
    expect(baseBlockNumber).toBe(111n)
  })

  it('settles each source exactly once, after all wallets', async () => {
    const settled: string[] = []
    await gatherMultiInputs(
      [A, B],
      null,
      {
        chains: async () => ({ values: {}, baseBlockNumber: null }),
        github: async () => ({}),
        speedrun: async () => ok(0),
        verifiedBuilder: async () => ok(0),
      },
      (source) => settled.push(source),
    )
    expect(settled).toHaveLength(4)
    expect([...settled].sort()).toEqual(['chains', 'github', 'speedrun', 'verifiedBuilder'])
  })

  it('marks a credential unavailable when any wallet could not be checked', async () => {
    const { inputs } = await gatherMultiInputs([A, B], null, {
      chains: async (address) => ({
        values: {
          eth_global_hacker:
            address === B ? { status: 'unavailable' as const, reason: 'rpc down' } : ok(1),
        },
        baseBlockNumber: null,
      }),
      github: async () => ({}),
      speedrun: async () => ok(0),
      verifiedBuilder: async () => ok(0),
    })
    expect(inputs.values.eth_global_hacker).toEqual({ status: 'unavailable', reason: 'rpc down' })
  })

  it('rejects an empty address list', async () => {
    await expect(gatherMultiInputs([], null)).rejects.toThrow()
  })
})

describe('aggregate order invariance', () => {
  // The aggregate schema stores extra_wallets in canonical (sorted) order, not
  // the order the user typed. That is only safe because the score does not
  // depend on merge order: sum_all sums across accounts and max_value takes the
  // best, both commutative. Merge order affects only the `unavailable` reason
  // string, which feeds neither total nor complete.
  const A = '0x0000000000000000000000000000000000000001' as const
  const B = '0x0000000000000000000000000000000000000002' as const

  const fetchersFor = () => ({
    chains: async (address: `0x${string}`) => ({
      values:
        address === A
          ? { eth_global_hacker: ok(1), github_forks: ok(3) }
          : { eth_global_hacker: ok(5), github_forks: ok(7) },
      baseBlockNumber: address === A ? 123n : 456n,
    }),
    github: async () => ({ github_followers: ok(170) }),
    speedrun: async (address: string) => ok(address === A ? 4 : 9),
    verifiedBuilder: async (address: string) => ok(address === A ? 2 : 6),
  })

  it('scores the same total whichever order the wallets arrive in', async () => {
    const forward = await gatherMultiInputs([A, B], 'octocat', fetchersFor())
    const reverse = await gatherMultiInputs([B, A], 'octocat', fetchersFor())

    // Pin computedAt so the age-based credentials can't drift between the two runs.
    const at = 1784975866
    const scoreOf = (g: Awaited<ReturnType<typeof gatherMultiInputs>>) =>
      computeScore({ ...g.inputs, computedAt: at }, spec)

    expect(scoreOf(forward).total).toBe(scoreOf(reverse).total)
    expect(scoreOf(forward).total).toBeGreaterThan(0)
    expect(scoreOf(forward).complete).toBe(scoreOf(reverse).complete)
  })
})
