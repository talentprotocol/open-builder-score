import { createPublicClient, fallback, http } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { MAINNET_RPC_URLS } from './chains'

export type EnsResolution =
  | { status: 'resolved'; address: `0x${string}` }
  | { status: 'unresolved' }
  | { status: 'error'; reason: string }

export type EnsResolverFn = (name: string) => Promise<`0x${string}` | null>

export function looksLikeEnsName(value: string): boolean {
  const v = value.trim()
  return v.length > 2 && v.includes('.') && !/\s/.test(v)
}

let cachedResolver: EnsResolverFn | null = null

function defaultResolver(): EnsResolverFn {
  const client = createPublicClient({
    chain: mainnet,
    transport: fallback(MAINNET_RPC_URLS.map((url) => http(url))),
  })
  return (name) => client.getEnsAddress({ name })
}

export async function resolveEnsName(
  name: string,
  resolver?: EnsResolverFn,
): Promise<EnsResolution> {
  let normalized: string
  try {
    normalized = normalize(name.trim())
  } catch {
    return { status: 'error', reason: 'That isn’t a valid ENS name.' }
  }
  const resolve = resolver ?? (cachedResolver ??= defaultResolver())
  try {
    const address = await resolve(normalized)
    return address ? { status: 'resolved', address } : { status: 'unresolved' }
  } catch {
    return { status: 'error', reason: 'ENS lookup failed — try again.' }
  }
}
