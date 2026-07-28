// Display-layer derivation of the credential reference from spec.json — the
// same file the engine scores with, so the reference can never drift.
// Pure module: no framework, no fetches. Unknown enum values throw so a bad
// spec edit fails the tests instead of shipping a wrong page.

import type { Spec, SpecCredential } from './types'

export interface CredentialGroup {
  key: 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'
  label: string
  credentials: SpecCredential[]
  maxTotal: number
}

const SPEEDRUN_SLUG = 'buidl_guidl_speedrun_ethereum'
const EAS_SLUG = 'talent_protocol_verified_builder'

// Group order and vocabulary mirror the scan checklist (SOURCE_LABELS on the
// results page), so the reference reads as the annotated version of the scan.
export function groupCredentials(spec: Spec): CredentialGroup[] {
  const active = spec.credentials.filter((c) => c.poc)
  const groups: Omit<CredentialGroup, 'maxTotal'>[] = [
    {
      key: 'chains',
      label: 'Onchain badges & balances',
      // Deliberate negation: everything not claimed by the three specific
      // groups lands here, so every active credential appears somewhere (the
      // coverage test enforces it). A positive tier filter would silently drop
      // a newly activated credential on an unlisted tier.
      credentials: active.filter(
        (c) => c.tier !== 'github_public' && c.slug !== SPEEDRUN_SLUG && c.slug !== EAS_SLUG,
      ),
    },
    { key: 'github', label: 'GitHub', credentials: active.filter((c) => c.tier === 'github_public') },
    {
      key: 'speedrun',
      label: 'SpeedRun Ethereum',
      credentials: active.filter((c) => c.slug === SPEEDRUN_SLUG),
    },
    {
      key: 'verifiedBuilder',
      label: 'EAS attestations',
      credentials: active.filter((c) => c.slug === EAS_SLUG),
    },
  ]
  return groups.map((g) => ({
    ...g,
    maxTotal: g.credentials.reduce((sum, c) => sum + c.max_score, 0),
  }))
}

// General form of the engine's instantiated formula (engine.ts renders
// `min(round(sqrt(9) × 0.03), 8) = 1`; the reference abstracts the value).
export function formatFormula(c: SpecCredential): string {
  return `min(round(${generalConverted(c.conversion)} × ${c.multiplier}), ${c.max_score})`
}

function generalConverted(conversion: string): string {
  switch (conversion) {
    case 'no_conversion':
      return 'value'
    case 'sqrt':
      return 'sqrt(value)'
    case 'log':
      return 'ln(value)'
    case 'timestamp_to_year':
      return 'years'
    default:
      throw new Error(`no general form for conversion: ${conversion}`)
  }
}

const VALUE_DESCRIPTIONS: Record<string, string> = {
  nft_count: 'badges held',
  distinct_contracts_owned: 'distinct qualifying contracts held',
  erc20_balance_whole_tokens: 'token balance (whole tokens)',
  contract_call: 'vault balance',
  distinct_attesters: 'distinct attesters',
  created_at_unix_timestamp: 'account creation date',
  followers_count: 'followers',
  sum_stargazers_over_owned_repos: 'stars across owned repos',
  sum_forks_over_owned_repos: 'forks across owned repos',
  public_repo_count: 'public repositories',
  accepted_challenge_count: 'accepted challenges',
}

export function describeValue(c: SpecCredential): string {
  const description = VALUE_DESCRIPTIONS[c.value]
  if (!description) throw new Error(`no description for value kind: ${c.value}`)
  return description
}

// Multi-wallet aggregation, in the user's terms. GitHub data comes from a
// single handle — wallets never change those points — so no label there.
export function describeCalculation(c: SpecCredential): string | null {
  if (c.tier === 'github_public') return null
  switch (c.calculation as string) {
    case 'sum_all':
      return 'summed across wallets'
    case 'max_value':
      return 'best wallet counts'
    default:
      throw new Error(`no label for calculation: ${c.calculation}`)
  }
}

// Curated user-facing notes. Raw spec notes are dev-facing and stay out of
// the UI; only these two change what a reader should expect from a score.
const DISPLAY_NOTES: Record<string, string> = {
  github_repositories: 'Approximates production: public repo count vs. repos contributed-to.',
  base_learn: 'Badges live on Base Sepolia (testnet).',
}

export function displayNote(c: SpecCredential): string | null {
  return DISPLAY_NOTES[c.slug] ?? null
}
