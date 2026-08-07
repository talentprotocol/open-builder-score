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
import type { BadgeDefinition } from './types'

const CHAIN_LABELS: Record<string, string> = {
  'eth-mainnet': 'Ethereum',
  'opt-mainnet': 'Optimism',
  'polygon-mainnet': 'Polygon',
  'arb-mainnet': 'Arbitrum',
  'base-mainnet': 'Base',
  'base-sepolia': 'Base Sepolia',
  'celo-mainnet': 'Celo',
}

// One line per check, named concretely: the contract call a live read makes,
// the size and chains of a frozen set, the export a membership comes from.
// Checks are OR'd — either one earns the badge — so a badge with two joins
// them with "or"; hiding the second would misrepresent where an earned badge
// came from.
export function describeBadgeCheck(badge: BadgeDefinition): string {
  const chainList = (chains: string[]) =>
    chains.map((c) => CHAIN_LABELS[c] ?? c).join(' and ')

  const segments = badgeChecks(badge).map((check) => {
    if (check === 'rpc') {
      if (!badge.call || !badge.contracts) {
        throw new Error(`rpc badge ${badge.slug} needs a call and contracts to describe`)
      }
      return `Live read of ${badge.call} on ${chainList(badge.contracts.map((c) => c.chain))}.`
    }
    if (check === 'allowlist') {
      const list = badge.allowlist ? allowlists[badge.allowlist] : undefined
      return `Frozen set of ${list?.count ?? 0} wallets from factory history on ${chainList(Object.keys(list?.chains ?? {}))}.`
    }
    return 'Talent Protocol export.'
  })
  return segments.length > 0 ? segments.join(' or ') : 'No check configured.'
}
