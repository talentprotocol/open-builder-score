// Live RPC badge reads. Separate from chains.ts because that module's
// multicall is hardcoded to balanceOf / userBalanceMeta, while badges ask
// different questions of different ABIs. Same shape though: one multicall per
// chain, allowFailure, and a failed read never passes as "not earned".

import { parseAbi, zeroAddress } from 'viem'
import badgeSpecJson from '../../spec/badges.json'
import { CHAIN_CONFIG, CHAIN_IDS, clientFor } from './chains'
import type { BadgeDefinition, BadgeInput, BadgeMethod, BadgeSpec } from './types'

const badgeSpec = badgeSpecJson as BadgeSpec

export interface PlannedBadgeRead {
  slug: string
  method: BadgeMethod
  functionName: string
  address: `0x${string}`
}
export interface BadgeChainPlan {
  chainId: number
  reads: PlannedBadgeRead[]
}
export interface BadgeReadOutcome {
  success: boolean
  value: string | bigint | null
}

export function rpcBadges(spec: BadgeSpec = badgeSpec): BadgeDefinition[] {
  return spec.badges.filter((b) => b.source === 'rpc')
}

// "talentsToTokens(address)" → "talentsToTokens". The spec keeps the full
// signature because that is what a reader verifying by hand would paste.
export function functionNameOf(call: string): string {
  const name = call.split('(')[0].trim()
  if (!name) throw new Error(`badge call is missing a function name: ${call}`)
  return name
}

export function buildBadgePlan(spec: BadgeSpec = badgeSpec): BadgeChainPlan[] {
  const byChain = new Map<number, PlannedBadgeRead[]>()
  for (const badge of rpcBadges(spec)) {
    if (!badge.method || !badge.call || !badge.contracts) {
      throw new Error(`rpc badge ${badge.slug} needs method, call and contracts`)
    }
    for (const contract of badge.contracts) {
      const chainId = CHAIN_IDS[contract.chain]
      if (chainId === undefined) {
        throw new Error(`badge ${badge.slug} names unknown chain ${contract.chain}`)
      }
      if (!byChain.has(chainId)) byChain.set(chainId, [])
      byChain.get(chainId)!.push({
        slug: badge.slug,
        method: badge.method,
        functionName: functionNameOf(badge.call),
        address: contract.address as `0x${string}`,
      })
    }
  }
  return [...byChain.entries()].map(([chainId, reads]) => ({ chainId, reads }))
}

export function abiFor(read: PlannedBadgeRead) {
  return read.method === 'nonzero_address_call'
    ? parseAbi([`function ${read.functionName}(address) view returns (address)`])
    : parseAbi([`function ${read.functionName}(address) view returns (uint256)`])
}

function isEarned(method: BadgeMethod, value: string | bigint): boolean {
  return method === 'nonzero_address_call'
    ? String(value).toLowerCase() !== zeroAddress
    : (value as bigint) > 0n
}

// One contract proving the badge is enough; a failure only matters when
// nothing else earned it. A Celo hiccup must not hide a Polygon Talent Token.
export function aggregateBadgeOutcomes(
  plan: BadgeChainPlan,
  outcomes: BadgeReadOutcome[],
): Record<string, BadgeInput> {
  const earned = new Set<string>()
  const failed = new Set<string>()

  plan.reads.forEach((read, i) => {
    const outcome = outcomes[i]
    if (!outcome.success || outcome.value === null) {
      failed.add(read.slug)
      return
    }
    if (isEarned(read.method, outcome.value)) earned.add(read.slug)
  })

  const result: Record<string, BadgeInput> = {}
  for (const slug of new Set(plan.reads.map((r) => r.slug))) {
    result[slug] = earned.has(slug)
      ? { status: 'ok', earned: true }
      : failed.has(slug)
        ? { status: 'unavailable', reason: 'contract read failed' }
        : { status: 'ok', earned: false }
  }
  return result
}

// Same OR-shaped fold as above, one level up: across chains, then (in
// orchestrate) across wallets.
export function mergeBadgeInputs(a: BadgeInput, b: BadgeInput): BadgeInput {
  if (a.status === 'ok' && a.earned) return a
  if (b.status === 'ok' && b.earned) return b
  if (a.status === 'unavailable') return a
  if (b.status === 'unavailable') return b
  return { status: 'ok', earned: false }
}

export function mergeBadgeValues(
  perChain: Record<string, BadgeInput>[],
): Record<string, BadgeInput> {
  const merged: Record<string, BadgeInput> = {}
  for (const chainValues of perChain) {
    for (const [slug, value] of Object.entries(chainValues)) {
      merged[slug] = slug in merged ? mergeBadgeInputs(merged[slug], value) : value
    }
  }
  return merged
}

export async function readRpcBadges(address: `0x${string}`): Promise<Record<string, BadgeInput>> {
  const plans = buildBadgePlan()

  const perChain = await Promise.all(
    plans.map(async (plan): Promise<Record<string, BadgeInput>> => {
      const chainName = CHAIN_CONFIG[plan.chainId]?.chain.name ?? `chain ${plan.chainId}`
      try {
        const outcomes = await clientFor(plan.chainId).multicall({
          contracts: plan.reads.map((read) => ({
            address: read.address,
            abi: abiFor(read),
            functionName: read.functionName,
            args: [address],
          })),
          allowFailure: true,
        })
        return aggregateBadgeOutcomes(
          plan,
          outcomes.map((o) => ({
            success: o.status === 'success',
            value: o.status === 'success' ? (o.result as string | bigint) : null,
          })),
        )
      } catch {
        const unavailable: Record<string, BadgeInput> = {}
        for (const slug of new Set(plan.reads.map((r) => r.slug))) {
          unavailable[slug] = { status: 'unavailable', reason: `${chainName} RPC unavailable` }
        }
        return unavailable
      }
    }),
  )

  return mergeBadgeValues(perChain)
}
