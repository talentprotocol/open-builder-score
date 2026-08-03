// Badge evaluation and gathering. Pure module for the evaluation half; the
// gather half takes injectable fetchers, like orchestrate.ts.
//
// Badges are zero-point by construction: nothing here touches computeScore,
// ScoreResult.complete, or the attestation payload. They sit beside the score.

import badgeSpecJson from '../../spec/badges.json'
import { mergeBadgeInputs, readRpcBadges } from './badge-reads'
import { readAllowlistBadge } from './allowlists'
import { readSnapshotBadge, snapshotMeta } from './snapshots'
import type { BadgeCheck, BadgeDefinition, BadgeInput, BadgeResult, BadgeSpec } from './types'

const badgeSpec = badgeSpecJson as BadgeSpec

export const badgeDefinitions = badgeSpec.badges

// A badge's checks, in the order they run. More than one is normal: the $BUILD
// badge reads the onchain accumulator *and* a snapshot, because each sees
// contributors the other cannot.
export function badgeChecks(badge: BadgeDefinition): BadgeCheck[] {
  const checks: BadgeCheck[] = []
  if (badge.contracts?.length) checks.push('rpc')
  if (badge.allowlist) checks.push('allowlist')
  if (badge.source === 'snapshot' || badge.snapshot) checks.push('snapshot')
  return checks
}

export function usesSnapshot(badge: BadgeDefinition): boolean {
  return badgeChecks(badge).includes('snapshot')
}

export function evaluateBadges(
  values: Record<string, BadgeInput>,
  spec: BadgeSpec = badgeSpec,
  asOf: string | null = snapshotMeta.generated_at,
): BadgeResult[] {
  return spec.badges.map((badge) => {
    const input = values[badge.slug] ?? { status: 'unavailable' as const, reason: 'not checked' }
    const base = {
      slug: badge.slug,
      name: badge.name,
      description: badge.description,
      source: badge.source,
      ...(usesSnapshot(badge) ? { asOf } : {}),
    }
    if (input.status === 'unavailable') {
      return { ...base, state: 'unavailable' as const, unavailableReason: input.reason }
    }
    return { ...base, state: input.earned ? ('earned' as const) : ('not_earned' as const) }
  })
}

export interface BadgeFetchers {
  rpc: (address: `0x${string}`) => Promise<Record<string, BadgeInput>>
  snapshot: (slug: string, address: string) => Promise<BadgeInput>
  allowlist: (name: string, address: string) => BadgeInput
}

const defaultBadgeFetchers: BadgeFetchers = {
  rpc: readRpcBadges,
  snapshot: (slug, address) => readSnapshotBadge(slug, address),
  allowlist: readAllowlistBadge,
}

// One wallet earning a badge earns it for the profile, so results OR across
// wallets — the opposite of credentials, where every wallet has to be readable
// before a value can be trusted.
export async function gatherBadges(
  addresses: `0x${string}`[],
  fetchers: Partial<BadgeFetchers> = {},
  spec: BadgeSpec = badgeSpec,
  asOf: string | null = snapshotMeta.generated_at,
): Promise<BadgeResult[]> {
  if (addresses.length === 0) throw new Error('gatherBadges requires at least one address')
  const f = { ...defaultBadgeFetchers, ...fetchers }
  const snapshotSlugs = spec.badges.filter(usesSnapshot).map((b) => b.slug)

  const [rpcResults, snapshotResults] = await Promise.all([
    Promise.all(addresses.map((address) => f.rpc(address))),
    Promise.all(
      snapshotSlugs.map(async (slug) => ({
        slug,
        inputs: await Promise.all(addresses.map((address) => f.snapshot(slug, address))),
      })),
    ),
  ])

  const values: Record<string, BadgeInput> = {}
  for (const perWallet of rpcResults) {
    for (const [slug, input] of Object.entries(perWallet)) {
      values[slug] = slug in values ? mergeBadgeInputs(values[slug], input) : input
    }
  }
  // Fold, never overwrite: a badge can carry more than one check, and the
  // whole point of the $BUILD snapshot is to add to what the onchain read
  // found rather than replace it.
  const fold = (slug: string, input: BadgeInput) => {
    values[slug] = slug in values ? mergeBadgeInputs(values[slug], input) : input
  }

  for (const { slug, inputs } of snapshotResults) {
    fold(slug, inputs.reduce(mergeBadgeInputs))
  }

  // Allowlists are bundled data — no await, no failure mode beyond a bad slug.
  for (const badge of spec.badges) {
    if (!badge.allowlist) continue
    fold(
      badge.slug,
      addresses.map((address) => f.allowlist(badge.allowlist!, address)).reduce(mergeBadgeInputs),
    )
  }

  // A badge that declares a check nobody could run is unavailable, not
  // not-earned — otherwise a misconfigured spec reads as a clean negative.
  for (const badge of spec.badges) {
    if (badgeChecks(badge).length === 0) {
      values[badge.slug] = { status: 'unavailable', reason: `${badge.slug} declares no checks` }
    }
  }

  return evaluateBadges(values, spec, asOf)
}
