import { describe, it, expect } from 'vitest'
import { zeroAddress } from 'viem'
import {
  aggregateBadgeOutcomes,
  buildBadgePlan,
  functionNameOf,
  mergeBadgeValues,
  rpcBadges,
  type BadgeChainPlan,
} from '@/lib/badge-reads'
import { CHAIN_CONFIG, CHAIN_IDS } from '@/lib/chains'

const plan: BadgeChainPlan = {
  chainId: 42220,
  reads: [
    {
      slug: 'talent_token_launched',
      method: 'nonzero_address_call',
      functionName: 'talentsToTokens',
      address: `0x${'1'.repeat(40)}`,
    },
    {
      slug: 'build_contributor',
      method: 'positive_uint_call',
      functionName: 'donated',
      address: `0x${'2'.repeat(40)}`,
    },
  ],
}

const ok = (value: string | bigint) => ({ success: true, value })
const failed = { success: false, value: null }

describe('functionNameOf', () => {
  it('strips the signature', () => {
    expect(functionNameOf('talentsToTokens(address)')).toBe('talentsToTokens')
  })
  it('rejects a signature with no name', () => {
    expect(() => functionNameOf('(address)')).toThrow()
  })
})

describe('aggregateBadgeOutcomes', () => {
  it('reads a non-zero address as earned and the zero address as not', () => {
    const earned = aggregateBadgeOutcomes(plan, [ok(`0x${'9'.repeat(40)}`), ok(0n)])
    expect(earned.talent_token_launched).toEqual({ status: 'ok', earned: true })
    const not = aggregateBadgeOutcomes(plan, [ok(zeroAddress), ok(0n)])
    expect(not.talent_token_launched).toEqual({ status: 'ok', earned: false })
  })

  it('reads a positive uint as earned and zero as not', () => {
    expect(aggregateBadgeOutcomes(plan, [ok(zeroAddress), ok(1n)]).build_contributor).toEqual({
      status: 'ok',
      earned: true,
    })
    expect(aggregateBadgeOutcomes(plan, [ok(zeroAddress), ok(0n)]).build_contributor).toEqual({
      status: 'ok',
      earned: false,
    })
  })

  it('treats a failed read as unavailable, not as not-earned', () => {
    const result = aggregateBadgeOutcomes(plan, [failed, ok(0n)])
    expect(result.talent_token_launched).toEqual({
      status: 'unavailable',
      reason: 'contract read failed',
    })
  })

  it('ignores a failed read on a badge another contract already earned', () => {
    const twoContracts: BadgeChainPlan = {
      chainId: 42220,
      reads: [plan.reads[0], { ...plan.reads[0], address: `0x${'3'.repeat(40)}` }],
    }
    const result = aggregateBadgeOutcomes(twoContracts, [failed, ok(`0x${'9'.repeat(40)}`)])
    expect(result.talent_token_launched).toEqual({ status: 'ok', earned: true })
  })
})

describe('mergeBadgeValues', () => {
  it('folds a badge that spans chains', () => {
    const merged = mergeBadgeValues([
      { talent_token_launched: { status: 'ok', earned: false } },
      { talent_token_launched: { status: 'ok', earned: true } },
    ])
    expect(merged.talent_token_launched).toEqual({ status: 'ok', earned: true })
  })

  it('keeps unavailable when no chain earned it', () => {
    const merged = mergeBadgeValues([
      { talent_token_launched: { status: 'unavailable', reason: 'Celo RPC unavailable' } },
      { talent_token_launched: { status: 'ok', earned: false } },
    ])
    expect(merged.talent_token_launched).toEqual({
      status: 'unavailable',
      reason: 'Celo RPC unavailable',
    })
  })
})

describe('the shipped badge spec', () => {
  it('plans every rpc badge onto a configured chain', () => {
    const planned = buildBadgePlan()
    expect(planned.length).toBeGreaterThan(0)
    for (const chainPlan of planned) {
      expect(CHAIN_CONFIG[chainPlan.chainId], `chain ${chainPlan.chainId} has no RPC`).toBeDefined()
    }
  })

  it('covers every rpc badge with at least one contract on a known chain', () => {
    for (const badge of rpcBadges()) {
      expect(badge.contracts?.length, `${badge.slug} has no contracts`).toBeGreaterThan(0)
      for (const contract of badge.contracts ?? []) {
        expect(contract.address, `${badge.slug}/${contract.name}`).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(CHAIN_IDS[contract.chain], `${badge.slug} unknown chain`).toBeDefined()
      }
    }
  })

  it('pins the $BUILD contract and call', () => {
    const planned = buildBadgePlan().flatMap((p) => p.reads)
    const build = planned.find((r) => r.slug === 'build_contributor')
    expect(build?.address.toLowerCase()).toBe('0x556e182ad2b72f5934c2215d6a56cfc19936fdb7')
    expect(build?.functionName).toBe('donated')
    expect(build?.method).toBe('positive_uint_call')
  })

  it('does not try to read the Talent Token badge per wallet', () => {
    // The Celo factory only maps token → talent, so talentsToTokens returns
    // 0x0 for real owners and hasTalentToken reverts. Asking it per wallet
    // would report earned wallets as not-earned — the allowlist exists
    // precisely so no live read is attempted here.
    const planned = buildBadgePlan().flatMap((p) => p.reads)
    expect(planned.map((r) => r.slug)).not.toContain('talent_token_launched')
  })
})
