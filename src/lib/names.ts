import { createPublicClient, fallback, http, namehash, getAddress } from 'viem'
import { base, mainnet } from 'viem/chains'
import { CHAIN_CONFIG, MAINNET_RPC_URLS } from './chains'

// Reverse records are claims: anyone can point their reverse name at any
// string, so a basename counts only after its forward resolution returns the
// same address. Mainnet ENS needs no such check here — viem's getEnsName
// verifies forward resolution itself.
const BASENAME_L2_RESOLVER = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as const
// ENSIP-19 standalone reverse registrar on Base; post-2025 registrations may
// only exist here, older ones only on the L2Resolver — so both are read.
const BASENAME_L2_REVERSE_REGISTRAR = '0x0000000000D8e504002cC26E3Ec46D81971C1664' as const
const BASE_COIN_TYPE_HEX = '80002105' // 0x80000000 | 8453, per ENSIP-19

const L2_RESOLVER_ABI = [
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
] as const

const L2_REVERSE_REGISTRAR_ABI = [
  {
    name: 'nameForAddr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'string' }],
  },
] as const

export function basenameReverseNode(address: string): `0x${string}` {
  return namehash(`${address.toLowerCase().slice(2)}.${BASE_COIN_TYPE_HEX}.reverse`)
}

export interface NameLookupDeps {
  /** One claimed basename (or null) per address, same order. */
  basenameReverse: (addresses: readonly `0x${string}`[]) => Promise<(string | null)[]>
  /** Forward resolution of each basename on Base, same order. */
  basenameForward: (names: readonly string[]) => Promise<(`0x${string}` | null)[]>
  /** Forward-verified mainnet ENS reverse lookup. */
  ensName: (address: `0x${string}`) => Promise<string | null>
}

let cachedDeps: NameLookupDeps | null = null

function defaultDeps(): NameLookupDeps {
  const baseClient = createPublicClient({
    chain: base,
    transport: fallback(CHAIN_CONFIG[8453].rpcUrls.map((url) => http(url))),
  })
  const mainnetClient = createPublicClient({
    chain: mainnet,
    transport: fallback(MAINNET_RPC_URLS.map((url) => http(url))),
  })
  return {
    basenameReverse: async (addresses) => {
      const results = await baseClient.multicall({
        contracts: addresses.flatMap((address) => [
          {
            address: BASENAME_L2_REVERSE_REGISTRAR,
            abi: L2_REVERSE_REGISTRAR_ABI,
            functionName: 'nameForAddr' as const,
            args: [address] as const,
          },
          {
            address: BASENAME_L2_RESOLVER,
            abi: L2_RESOLVER_ABI,
            functionName: 'name' as const,
            args: [basenameReverseNode(address)] as const,
          },
        ]),
      })
      return addresses.map((_, i) => {
        const fromRegistrar = results[i * 2]
        const fromResolver = results[i * 2 + 1]
        const name =
          (fromRegistrar.status === 'success' && (fromRegistrar.result as string)) ||
          (fromResolver.status === 'success' && (fromResolver.result as string)) ||
          null
        return name || null
      })
    },
    basenameForward: async (names) => {
      const results = await baseClient.multicall({
        contracts: names.map((name) => ({
          address: BASENAME_L2_RESOLVER,
          abi: L2_RESOLVER_ABI,
          functionName: 'addr' as const,
          args: [namehash(name)] as const,
        })),
      })
      return results.map((r) =>
        r.status === 'success' && r.result ? (r.result as `0x${string}`) : null,
      )
    },
    ensName: (address) => mainnetClient.getEnsName({ address }),
  }
}

// Shared across mounts (leaderboard + attestations) so an address is only
// ever resolved once per session.
const nameCache = new Map<string, string | null>()

export async function resolveDisplayNames(
  addresses: readonly string[],
  deps?: NameLookupDeps,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const pending: `0x${string}`[] = []
  const seen = new Set<string>()
  for (const address of addresses) {
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const cached = deps ? undefined : nameCache.get(key)
    if (cached !== undefined) {
      if (cached !== null) resolved.set(key, cached)
      continue
    }
    pending.push(address as `0x${string}`)
  }
  if (pending.length === 0) return resolved

  const lookups = deps ?? (cachedDeps ??= defaultDeps())

  let basenames: (string | null)[]
  try {
    basenames = await lookups.basenameReverse(pending)
  } catch {
    basenames = pending.map(() => null)
  }

  // Forward-verify every claimed basename in one batch.
  const claims = pending
    .map((address, i) => ({ address, name: basenames[i] }))
    .filter((c): c is { address: `0x${string}`; name: string } => c.name !== null)
  const verified = new Map<string, string>()
  if (claims.length > 0) {
    try {
      const forwards = await lookups.basenameForward(claims.map((c) => c.name))
      claims.forEach((claim, i) => {
        const forward = forwards[i]
        if (forward && getAddress(forward) === getAddress(claim.address)) {
          verified.set(claim.address.toLowerCase(), claim.name)
        }
      })
    } catch {
      // Unverifiable claims are dropped, never displayed.
    }
  }

  await Promise.all(
    pending.map(async (address) => {
      const key = address.toLowerCase()
      let name = verified.get(key) ?? null
      if (name === null) {
        try {
          name = await lookups.ensName(address)
        } catch {
          name = null
        }
      }
      if (!deps) nameCache.set(key, name)
      if (name !== null) resolved.set(key, name)
    }),
  )
  return resolved
}
