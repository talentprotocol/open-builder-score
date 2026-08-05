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

/**
 * What a verifier can say about an attested badge. The attestation records the
 * slug but not which check earned it, so this classifies by what the badge is
 * *able* to rest on — the cautious reading.
 *
 * - 'public' — every check is permissionless. Only talent_token_launched: its
 *   allowlist is rebuilt from TalentCreated events on Celo and Polygon.
 * - 'mixed'  — an OR of a live read and a dated export. $BUILD Contributor is
 *   earned by donated() > 0 or by the pay-it-forward export, and the record
 *   does not say which, so it cannot be called public.
 * - 'export' — the only evidence is a Talent Protocol export with no
 *   permissionless source.
 */
export type BadgeEvidence = 'public' | 'mixed' | 'export'

export interface AttestedBadge {
  slug: string
  name: string
  evidence: BadgeEvidence
}

/**
 * How strongly a badge can be checked, from its declared checks alone. The
 * results screen knows no more than a verifier does: gatherBadges ORs a
 * badge's checks together and keeps no record of which one fired, so a badge
 * that *can* rest on an export is classified as if it did.
 */
export function badgeEvidence(badge: BadgeDefinition): BadgeEvidence {
  const permissionless = badgeChecks(badge).filter((c) => c !== 'snapshot')
  if (permissionless.length === 0) return 'export'
  return usesSnapshot(badge) ? 'mixed' : 'public'
}

export function classifyAttestedBadges(
  slugs: string[],
  spec: BadgeSpec = badgeSpec,
): AttestedBadge[] {
  return slugs.map((slug) => {
    const def = spec.badges.find((b) => b.slug === slug)
    // An unknown slug stays visible, classified at the cautious end: hiding it
    // would understate the claim, and assuming it public would overstate it.
    if (!def) return { slug, name: slug, evidence: 'export' as const }
    return { slug, name: def.name, evidence: badgeEvidence(def) }
  })
}
