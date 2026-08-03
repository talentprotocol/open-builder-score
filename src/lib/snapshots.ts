// Snapshot badge membership. Builder Score and Builder Rewards have no
// permissionless source, so they ship as a dated export sharded by the first
// byte of the address: one small fetch per badge instead of a multi-MB list.
//
// Every shard is written, empty ones included (scripts/build-snapshots.mjs),
// so a 404 means a broken deploy — reported as unavailable — rather than
// quietly reading as "not earned".

import snapshotMetaJson from '../../spec/snapshots.json'
import type { BadgeInput, SnapshotMeta } from './types'

export const snapshotMeta = snapshotMetaJson as SnapshotMeta

// The two hex characters after 0x. 256 shards, uniform by construction since
// addresses are hashes.
export function shardKey(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`not an EVM address: ${address}`)
  return hex.slice(0, 2)
}

export function snapshotShardPath(slug: string, address: string): string {
  return `/snapshots/${slug}/${shardKey(address)}.json`
}

export async function readSnapshotBadge(
  slug: string,
  address: string,
  fetchImpl: typeof fetch = fetch,
  meta: SnapshotMeta = snapshotMeta,
): Promise<BadgeInput> {
  if (!meta.generated_at) {
    return { status: 'unavailable', reason: 'snapshot not published yet' }
  }
  try {
    const response = await fetchImpl(snapshotShardPath(slug, address))
    if (!response.ok) {
      return { status: 'unavailable', reason: `snapshot shard missing (${response.status})` }
    }
    const body = await response.json()
    if (!Array.isArray(body)) {
      return { status: 'unavailable', reason: 'snapshot shard has an unexpected shape' }
    }
    const wanted = address.toLowerCase()
    return {
      status: 'ok',
      earned: body.some((entry) => typeof entry === 'string' && entry.toLowerCase() === wanted),
    }
  } catch {
    return { status: 'unavailable', reason: 'snapshot unreachable' }
  }
}
