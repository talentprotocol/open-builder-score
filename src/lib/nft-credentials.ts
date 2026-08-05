// Credentials read from a generated allowlist rather than a live call.
//
// Devfolio winners and Base Basecamp attendance both need more than balanceOf:
// telling a winner from a participant means reading the token's metadata, and
// Basecamp's attendee SBTs are ERC-1155 so balanceOf reverts outright. Neither
// is a call a browser can afford per wallet, so the answer is precomputed by
// scripts/build-nft-credential-allowlists.mjs and shipped as shards.
//
// This is public chain data — anyone can re-run the generator and get the same
// counts — which is what separates it from the Builder Score and Builder
// Rewards snapshots. Those have no permissionless source at all. It is the
// same standing as the talent-token-launched allowlist.
//
// The collections are closed: every one was minted at an event that has
// already happened, so the lists are frozen rather than decaying.

import manifestJson from '../../spec/nft-credentials.json'
import type { CredentialInput, NftCredentialManifest } from './types'

export const nftCredentialManifest = manifestJson as NftCredentialManifest

export const nftCredentialSlugs = Object.keys(nftCredentialManifest.credentials)

// Same sharding as the badge snapshots: the two hex characters after 0x, 256
// shards, uniform because addresses are hashes.
export function nftShardPath(slug: string, address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`not an EVM address: ${address}`)
  return `/nft-credentials/${slug}/${hex.slice(0, 2)}.json`
}

/**
 * A wallet absent from a shard scores zero — but only once the shard itself
 * has been read. A shard that will not load is "couldn't check", never zero:
 * these credentials are worth 80 points between them, and a fetch failure that
 * quietly scored 0 would understate a real builder while still reporting a
 * complete score. Same rule the snapshot badges follow.
 */
export async function readNftCredential(
  slug: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CredentialInput> {
  if (!(slug in nftCredentialManifest.credentials)) {
    return { status: 'unavailable', reason: `${slug} is not in the allowlist manifest` }
  }
  try {
    const response = await fetchImpl(nftShardPath(slug, address))
    if (!response.ok) {
      return { status: 'unavailable', reason: `allowlist shard missing (${response.status})` }
    }
    const body = await response.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { status: 'unavailable', reason: 'allowlist shard has an unexpected shape' }
    }
    const count = (body as Record<string, unknown>)[address.toLowerCase()]
    if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count))) {
      return { status: 'unavailable', reason: 'allowlist shard holds a non-numeric count' }
    }
    return { status: 'ok', accounts: [count ?? 0] }
  } catch {
    return { status: 'unavailable', reason: 'allowlist unreachable' }
  }
}

export async function readNftCredentials(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, CredentialInput>> {
  const entries = await Promise.all(
    nftCredentialSlugs.map(async (slug) => [slug, await readNftCredential(slug, address, fetchImpl)] as const),
  )
  return Object.fromEntries(entries)
}
