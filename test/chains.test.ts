import { describe, it, expect } from 'vitest'
import specJson from '../spec/spec.json'
import registryJson from '../spec/badge-registry.json'
import type { Registry, Spec } from '@/lib/types'
import { buildChainPlan, aggregateChainResults, mergeChainValues, type ChainPlan, type ReadOutcome } from '@/lib/chains'
import type { CredentialInput } from '@/lib/types'

const spec = specJson as Spec
const registry = registryJson as unknown as Registry
const activeRpcSlugs = new Set(
  spec.credentials.filter((c) => c.status === 'active' && c.tier === 'rpc').map((c) => c.slug),
)

describe('buildChainPlan', () => {
  const plan = buildChainPlan(registry, activeRpcSlugs)
  const byChain = Object.fromEntries(plan.map((p) => [p.chainId, p.reads.length]))

  // Excluding a credential also drops any chain it was the only reason to
  // dial: Ethereum went with CNC + $CODE, Base Sepolia with Base Learn. Four
  // chains instead of six means fewer ways for a scan to come back
  // incomplete, which is what gates attestation.
  it('plans the exact per-chain contract counts', () => {
    expect(byChain).toEqual({
      10: 29,     // 4 ETHGlobal packs + 19 finalists + 6 BuidlGuidl batches
      137: 1,     // ETHernals
      42161: 13,  // 7 Devfolio + 6 BuidlGuidl batches
      8453: 6,    // 3 Devfolio + 3 Base Devfolio
    })
  })

  it('still plans Base, which carries the as-of block anchor', () => {
    expect(plan.some((p) => p.chainId === 8453)).toBe(true)
  })

  it('never plans deferred, excluded, or non-rpc credentials', () => {
    const slugs = new Set(plan.flatMap((p) => p.reads.map((r) => r.slug)))
    expect(slugs.has('devfolio_hackathons_won')).toBe(false) // deferred
    expect(slugs.has('talent_vault')).toBe(false) // excluded
    expect(slugs.has('base_learn')).toBe(false) // excluded
    expect(slugs.has('talent_protocol_verified_builder')).toBe(false) // not rpc
  })

  // Asserted against an explicit slug set rather than the active set: the
  // registry entry survives the exclusion, and the method tagging is planner
  // behaviour that shouldn't ride on an editorial decision.
  it('tags a contract_call read with its method', () => {
    const vaultPlan = buildChainPlan(registry, new Set(['talent_vault']))
    const reads = vaultPlan.flatMap((p) => p.reads).filter((r) => r.slug === 'talent_vault')
    expect(reads).toHaveLength(1)
    expect(reads[0].method).toBe('contract_call')
    expect(reads[0].address).toBe('0x23Ff3256A29847d7EF760943bd6679b565CbdE5a')
  })
})

describe('aggregateChainResults', () => {
  const plan: ChainPlan = {
    chainId: 10,
    reads: [
      { slug: 'eth_global_hacker', method: 'nft_count', address: '0x0000000000000000000000000000000000000001' },
      { slug: 'eth_global_finalist', method: 'nft_count', address: '0x0000000000000000000000000000000000000002' },
      { slug: 'eth_global_finalist', method: 'nft_count', address: '0x0000000000000000000000000000000000000003' },
      { slug: 'buidl_guidl_batches_graduate', method: 'distinct_contracts_owned', address: '0x0000000000000000000000000000000000000004' },
      { slug: 'buidl_guidl_batches_graduate', method: 'distinct_contracts_owned', address: '0x0000000000000000000000000000000000000005' },
    ],
  }

  it('sums balances for nft_count and counts holdings for distinct_contracts_owned', () => {
    const outcomes: ReadOutcome[] = [
      { success: true, value: 2n },  // hacker: balance 2
      { success: true, value: 1n },  // finalist A
      { success: true, value: 1n },  // finalist B
      { success: true, value: 3n },  // batch A owned (balance 3 still = 1 contract)
      { success: true, value: 0n },  // batch B not owned
    ]
    expect(aggregateChainResults(plan, outcomes)).toEqual({
      eth_global_hacker: { status: 'ok', accounts: [2] },
      eth_global_finalist: { status: 'ok', accounts: [2] },
      buidl_guidl_batches_graduate: { status: 'ok', accounts: [1] },
    })
  })

  it('marks only the failing credential unavailable', () => {
    const outcomes: ReadOutcome[] = [
      { success: false, value: null },
      { success: true, value: 1n },
      { success: true, value: 0n },
      { success: true, value: 1n },
      { success: true, value: 1n },
    ]
    const result = aggregateChainResults(plan, outcomes)
    expect(result.eth_global_hacker).toEqual({
      status: 'unavailable',
      reason: 'contract read failed',
    })
    expect(result.eth_global_finalist).toEqual({ status: 'ok', accounts: [1] })
  })

  it('converts erc20 and vault values from wei to whole tokens', () => {
    const erc20Plan: ChainPlan = {
      chainId: 8453,
      reads: [
        { slug: 'talent_protocol_talent_holder', method: 'erc20_balance_whole_tokens', address: '0x0000000000000000000000000000000000000006' },
        { slug: 'talent_vault', method: 'contract_call', address: '0x0000000000000000000000000000000000000007' },
      ],
    }
    const outcomes: ReadOutcome[] = [
      { success: true, value: 900_000_000_000_000_000_000n },              // 900 tokens
      { success: true, value: [1_500_000_000_000_000_000n, 0n, 0n] },      // depositedAmount=1.5
    ]
    expect(aggregateChainResults(erc20Plan, outcomes)).toEqual({
      talent_protocol_talent_holder: { status: 'ok', accounts: [900] },
      talent_vault: { status: 'ok', accounts: [1.5] },
    })
  })
})

describe('mergeChainValues', () => {
  it('sums account counts across chains when every chain read the slug ok', () => {
    const chainA: Record<string, CredentialInput> = {
      devfolio_hackathons_participation: { status: 'ok', accounts: [2] },
    }
    const chainB: Record<string, CredentialInput> = {
      devfolio_hackathons_participation: { status: 'ok', accounts: [1] },
    }
    expect(mergeChainValues([chainA, chainB])).toEqual({
      devfolio_hackathons_participation: { status: 'ok', accounts: [3] },
    })
  })

  it('sums a slug spread across three chains', () => {
    expect(
      mergeChainValues([
        { devfolio_hackathons_participation: { status: 'ok', accounts: [2] } },
        { devfolio_hackathons_participation: { status: 'ok', accounts: [1] } },
        { devfolio_hackathons_participation: { status: 'ok', accounts: [4] } },
      ]),
    ).toEqual({
      devfolio_hackathons_participation: { status: 'ok', accounts: [7] },
    })
  })

  it('marks the slug unavailable if any chain is unavailable, preserving the reason', () => {
    const chainA: Record<string, CredentialInput> = {
      buidl_guidl_batches_graduate: { status: 'ok', accounts: [1] },
    }
    const chainB: Record<string, CredentialInput> = {
      buidl_guidl_batches_graduate: { status: 'unavailable', reason: 'Arbitrum One RPC unavailable' },
    }
    expect(mergeChainValues([chainA, chainB])).toEqual({
      buidl_guidl_batches_graduate: { status: 'unavailable', reason: 'Arbitrum One RPC unavailable' },
    })
  })

  it('keeps the first unavailable reason when multiple chains are unavailable', () => {
    expect(
      mergeChainValues([
        { buidl_guidl_batches_graduate: { status: 'unavailable', reason: 'OP Mainnet RPC unavailable' } },
        { buidl_guidl_batches_graduate: { status: 'unavailable', reason: 'Arbitrum One RPC unavailable' } },
      ]),
    ).toEqual({
      buidl_guidl_batches_graduate: { status: 'unavailable', reason: 'OP Mainnet RPC unavailable' },
    })
  })

  it('passes through slugs that appear on only one chain unchanged', () => {
    const chainA: Record<string, CredentialInput> = {
      eth_global_hacker: { status: 'ok', accounts: [2] },
    }
    const chainB: Record<string, CredentialInput> = {
      talent_vault: { status: 'ok', accounts: [1.5] },
      talent_protocol_talent_holder: { status: 'unavailable', reason: 'Base RPC unavailable' },
    }
    expect(mergeChainValues([chainA, chainB])).toEqual({
      eth_global_hacker: { status: 'ok', accounts: [2] },
      talent_vault: { status: 'ok', accounts: [1.5] },
      talent_protocol_talent_holder: { status: 'unavailable', reason: 'Base RPC unavailable' },
    })
  })
})
