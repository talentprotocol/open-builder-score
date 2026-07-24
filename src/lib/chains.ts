import {
  createPublicClient,
  fallback,
  http,
  parseAbi,
  type Chain,
  type PublicClient,
} from 'viem'
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon } from 'viem/chains'
import registryJson from '../../spec/badge-registry.json'
import type { CredentialInput, Registry } from './types'

const registry = registryJson as unknown as Registry

export interface PlannedRead {
  slug: string
  method: string
  address: `0x${string}`
}
export interface ChainPlan {
  chainId: number
  reads: PlannedRead[]
}
export interface ReadOutcome {
  success: boolean
  value: bigint | readonly bigint[] | null
}
export interface ChainReadResult {
  values: Record<string, CredentialInput>
  baseBlockNumber: bigint | null
}

const BALANCE_OF_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
// Verbatim from talent-api lib/abi/TalentVault.json; production uses output index 0 / 1e18.
const VAULT_ABI = parseAbi([
  'function userBalanceMeta(address) view returns (uint256 depositedAmount, uint256 lastRewardCalculation, uint256 lastDepositAt)',
])

// Public endpoints only — no API keys anywhere (README ground rule).
const CHAIN_CONFIG: Record<number, { chain: Chain; rpcUrls: string[] }> = {
  1: { chain: mainnet, rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://1rpc.io/eth', 'https://eth.drpc.org'] },
  10: { chain: optimism, rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://1rpc.io/op', 'https://optimism.drpc.org'] },
  137: { chain: polygon, rpcUrls: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic', 'https://polygon.drpc.org'] },
  42161: { chain: arbitrum, rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com', 'https://1rpc.io/arb', 'https://arbitrum.drpc.org'] },
  8453: { chain: base, rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://1rpc.io/base', 'https://base.drpc.org'] },
  84532: { chain: baseSepolia, rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com', 'https://base-sepolia.drpc.org'] },
}

export function buildChainPlan(reg: Registry, pocRpcSlugs: Set<string>): ChainPlan[] {
  const byChain = new Map<number, PlannedRead[]>()
  for (const [slug, entry] of Object.entries(reg.credentials)) {
    if (!pocRpcSlugs.has(slug) || !Array.isArray(entry.contracts)) continue
    for (const contract of entry.contracts) {
      const chainId = reg.chains[contract.chain]
      if (!byChain.has(chainId)) byChain.set(chainId, [])
      byChain.get(chainId)!.push({
        slug,
        method: entry.method,
        address: contract.address as `0x${string}`,
      })
    }
  }
  return [...byChain.entries()].map(([chainId, reads]) => ({ chainId, reads }))
}

function weiToTokens(wei: bigint): number {
  // Keep 4 decimals of precision without float overflow on large balances.
  return Number(wei / 100_000_000_000_000n) / 10_000
}

export function aggregateChainResults(
  plan: ChainPlan,
  outcomes: ReadOutcome[],
): Record<string, CredentialInput> {
  const failed = new Set<string>()
  const totals = new Map<string, number>()

  plan.reads.forEach((read, i) => {
    const outcome = outcomes[i]
    if (!outcome.success || outcome.value === null) {
      failed.add(read.slug)
      return
    }
    const previous = totals.get(read.slug) ?? 0
    switch (read.method) {
      case 'nft_count':
        totals.set(read.slug, previous + Number(outcome.value as bigint))
        break
      case 'distinct_contracts_owned':
        totals.set(read.slug, previous + ((outcome.value as bigint) > 0n ? 1 : 0))
        break
      case 'erc20_balance_whole_tokens':
        totals.set(read.slug, previous + weiToTokens(outcome.value as bigint))
        break
      case 'contract_call': {
        // talent_vault: userBalanceMeta → index 0 (depositedAmount) / 1e18
        const outputs = outcome.value as readonly bigint[]
        totals.set(read.slug, previous + weiToTokens(outputs[0]))
        break
      }
      default:
        failed.add(read.slug)
    }
  })

  const result: Record<string, CredentialInput> = {}
  for (const slug of new Set(plan.reads.map((r) => r.slug))) {
    result[slug] = failed.has(slug)
      ? { status: 'unavailable', reason: 'contract read failed' }
      : { status: 'ok', accounts: [totals.get(slug) ?? 0] }
  }
  return result
}

export function mergeChainValues(
  perChain: Record<string, CredentialInput>[],
): Record<string, CredentialInput> {
  // Credentials that span multiple chains (distinct contracts counted ACROSS
  // chains) appear once per chain map. Fold them so counts add up and a
  // partial read never masquerades as complete.
  const merged: Record<string, CredentialInput> = {}
  for (const chainValues of perChain) {
    for (const [slug, value] of Object.entries(chainValues)) {
      const existing = merged[slug]
      if (!existing) {
        merged[slug] = value
        continue
      }
      // First unavailable wins — attestation gating depends on this.
      if (existing.status === 'unavailable') continue
      if (value.status === 'unavailable') {
        merged[slug] = value
        continue
      }
      // Both ok → sum each chain's single-wallet count.
      merged[slug] = { status: 'ok', accounts: [existing.accounts[0] + value.accounts[0]] }
    }
  }
  return merged
}

function clientFor(chainId: number): PublicClient {
  const config = CHAIN_CONFIG[chainId]
  return createPublicClient({
    chain: config.chain,
    transport: fallback(config.rpcUrls.map((url) => http(url, { timeout: 15_000 })), { rank: false }),
  })
}

export async function readChainCredentials(
  address: `0x${string}`,
  pocRpcSlugs: Set<string>,
): Promise<ChainReadResult> {
  const plans = buildChainPlan(registry, pocRpcSlugs)
  let baseBlockNumber: bigint | null = null

  const perChain = await Promise.all(
    plans.map(async (plan): Promise<Record<string, CredentialInput>> => {
      const chainName = CHAIN_CONFIG[plan.chainId].chain.name
      try {
        const client = clientFor(plan.chainId)
        // Only Base's block number is used as the as-of anchor. Fetch it
        // alongside Base's multicall (a block-number failure must mark Base
        // unavailable), but never gate other chains on a block-number hiccup.
        const blockNumberPromise =
          plan.chainId === 8453 ? client.getBlockNumber() : Promise.resolve(null)
        const [blockNumber, outcomes] = await Promise.all([
          blockNumberPromise,
          client.multicall({
            contracts: plan.reads.map((read) => ({
              address: read.address,
              abi: read.method === 'contract_call' ? VAULT_ABI : BALANCE_OF_ABI,
              functionName: read.method === 'contract_call' ? 'userBalanceMeta' : 'balanceOf',
              args: [address],
            })),
            allowFailure: true,
          }),
        ])
        if (plan.chainId === 8453) baseBlockNumber = blockNumber
        return aggregateChainResults(
          plan,
          outcomes.map((o) => ({
            success: o.status === 'success',
            value: o.status === 'success' ? (o.result as bigint | readonly bigint[]) : null,
          })),
        )
      } catch {
        const unavailable: Record<string, CredentialInput> = {}
        for (const slug of new Set(plan.reads.map((r) => r.slug))) {
          unavailable[slug] = { status: 'unavailable', reason: `${chainName} RPC unavailable` }
        }
        return unavailable
      }
    }),
  )

  return { values: mergeChainValues(perChain), baseBlockNumber }
}
