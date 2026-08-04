// Display-layer derivation of the badge reference from spec/badges.json — the
// same file gatherBadges checks with, so /badges can never drift from what the
// results screen actually ran.
//
// Separate from credential-reference.ts on purpose. Badges carry no points, so
// they are not a fifth CredentialGroup and never enter the group/maxTotal
// accounting; keeping the two references apart is what stops that line from
// blurring. Pure module: no framework, no fetches.

import { allowlists } from './allowlists'
import { badgeChecks } from './badges'
import { snapshotMeta } from './snapshots'
import type { BadgeCheck, BadgeDefinition } from './types'

const CHAIN_LABELS: Record<string, string> = {
  'eth-mainnet': 'Ethereum',
  'opt-mainnet': 'Optimism',
  'polygon-mainnet': 'Polygon',
  'arb-mainnet': 'Arbitrum',
  'base-mainnet': 'Base',
  'base-sepolia': 'Base Sepolia',
  'celo-mainnet': 'Celo',
}

const CHECK_DESCRIPTIONS: Record<BadgeCheck, string> = {
  snapshot: 'Membership in a dated export from Talent Protocol.',
  allowlist: 'Membership in a frozen set rebuilt from public chain history.',
  rpc: '', // built per badge from its call + chains
}

function describeRpcCheck(badge: BadgeDefinition): string {
  if (!badge.call || !badge.contracts) {
    throw new Error(`rpc badge ${badge.slug} needs a call and contracts to describe`)
  }
  const chains = badge.contracts.map((c) => CHAIN_LABELS[c.chain] ?? c.chain).join(' and ')
  return `Live read of ${badge.call} on ${chains}.`
}

// Every check a badge runs, spelled out. Badges with two of them say so —
// hiding the second would misrepresent where an earned badge came from.
export function describeBadgeCheck(badge: BadgeDefinition): string {
  const checks = badgeChecks(badge)
  if (checks.length === 0) return 'No check configured.'
  return checks
    .map((check) => (check === 'rpc' ? describeRpcCheck(badge) : CHECK_DESCRIPTIONS[check]))
    .join(' ')
}

/**
 * Where the evidence physically lives, named concretely: the chains an
 * allowlist was rebuilt from, the contract call a live read makes, the date on
 * an export. The results ledger shows only the evidence class; this is the
 * page that has room to say which chains and which contract.
 */
export function badgeSourceDetail(
  badge: BadgeDefinition,
  asOf: string | null = snapshotMeta.generated_at,
): string {
  const chainList = (chains: string[]) =>
    chains.map((c) => CHAIN_LABELS[c] ?? c).join(' + ')

  const segments = badgeChecks(badge).map((check) => {
    if (check === 'rpc') {
      return `${chainList((badge.contracts ?? []).map((c) => c.chain))} · ${badge.call ?? 'onchain read'}`
    }
    if (check === 'allowlist') {
      const list = badge.allowlist ? allowlists[badge.allowlist] : undefined
      return `${chainList(Object.keys(list?.chains ?? {}))} · ${list?.count ?? 0} from factory history`
    }
    return `Talent Protocol export · ${asOf ?? 'not published yet'}`
  })
  // Checks are OR'd: either one earns the badge, and the result never records
  // which fired.
  return segments.length > 0 ? segments.join(' or ') : 'No check configured'
}
