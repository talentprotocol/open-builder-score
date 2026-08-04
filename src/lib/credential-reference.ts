// Display-layer derivation of the credential reference from spec.json — the
// same file the engine scores with, so the reference can never drift.
// Pure module: no framework, no fetches. Unknown enum values throw so a bad
// spec edit fails the tests instead of shipping a wrong page.

import registryJson from '../../spec/badge-registry.json'
import nftManifestJson from '../../spec/nft-credentials.json'
import type { Registry, Spec, SpecCredential } from './types'

const registry = registryJson as unknown as Registry

export interface CredentialGroup {
  key: 'chains' | 'nftCredentials' | 'github' | 'speedrun' | 'verifiedBuilder'
  label: string
  credentials: SpecCredential[]
  maxTotal: number
}

// The group is defined by what the generated allowlist actually carries, not
// by tier: `indexed` also covers talent_protocol_verified_builder, which has
// its own group and would otherwise be counted in both.
const NFT_SLUGS = new Set(Object.keys(nftManifestJson.credentials))

const SPEEDRUN_SLUG = 'buidl_guidl_speedrun_ethereum'
const EAS_SLUG = 'talent_protocol_verified_builder'

// Group order and vocabulary mirror the scan checklist (SOURCE_LABELS on the
// results page), so the reference reads as the annotated version of the scan.
export function groupCredentials(spec: Spec): CredentialGroup[] {
  const active = spec.credentials.filter((c) => c.status === 'active')
  const groups: Omit<CredentialGroup, 'maxTotal'>[] = [
    {
      key: 'chains',
      label: 'Onchain badges & balances',
      // Deliberate negation: everything not claimed by the three specific
      // groups lands here, so every active credential appears somewhere (the
      // coverage test enforces it). A positive tier filter would silently drop
      // a newly activated credential on an unlisted tier.
      credentials: active.filter(
        (c) =>
          c.tier !== 'github_public' &&
          !NFT_SLUGS.has(c.slug) &&
          c.slug !== SPEEDRUN_SLUG &&
          c.slug !== EAS_SLUG,
      ),
    },
    {
      // Read from a generated allowlist, not a live call — the metadata and
      // ERC-1155 enumeration behind these cost more than a browser can spend
      // per wallet. Public chain data all the same: the generator is shipped
      // and anyone can re-run it.
      key: 'nftCredentials',
      label: 'Hackathon & event NFTs',
      credentials: active.filter((c) => NFT_SLUGS.has(c.slug)),
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

// How many chains a credential scan actually dials, derived rather than
// written down: excluding a credential can retire a whole chain (CNC and
// $CODE were the only reason to touch Ethereum), and the scan checklist has
// to say the true number. Mirrors chains.ts's grouping without importing it,
// so the UI copy doesn't pull viem into its bundle; a test pins the two
// together.
export function scannedChainCount(spec: Spec): number {
  const chains = new Set<string>()
  for (const c of spec.credentials) {
    if (c.status !== 'active' || c.tier !== 'rpc') continue
    const entry = registry.credentials[c.slug]
    if (!entry || !Array.isArray(entry.contracts)) continue
    for (const contract of entry.contracts) chains.add(contract.chain)
  }
  return chains.size
}

export interface UncountedGroup {
  status: 'excluded' | 'deferred'
  label: string
  blurb: string
  credentials: SpecCredential[]
}

// The credentials the score deliberately leaves on the table. Stating why is
// the point of an open score: a reader can disagree with the cut and see
// exactly what it cost. `excluded` first — that is the editorial position;
// `deferred` is only a to-do list.
export function uncountedCredentials(spec: Spec): UncountedGroup[] {
  const groups: Omit<UncountedGroup, 'credentials'>[] = [
    {
      status: 'excluded',
      label: 'Excluded on purpose',
      blurb:
        'Computable, and left out anyway. Attendance, membership and token balances say what someone showed up to or bought, not what they built — and testnet badges are cheap to farm.',
    },
    {
      status: 'deferred',
      label: 'Not computable yet',
      blurb:
        'Credentials we want, blocked on reading NFT token metadata rather than plain balances. They are in the spec so the gap stays visible.',
    },
  ]
  return groups
    .map((g) => ({
      ...g,
      credentials: spec.credentials.filter((c) => c.status === g.status),
    }))
    .filter((g) => g.credentials.length > 0)
}

// Every uncounted credential must explain itself; a silent exclusion is
// exactly the thing this page exists to prevent.
export function statusReason(c: SpecCredential): string {
  if (c.status === 'active') throw new Error(`${c.slug} is active and has no status reason`)
  if (!c.status_reason) throw new Error(`${c.slug} is ${c.status} without a status_reason`)
  return c.status_reason
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
  distinct_contracts_with_winner_token: 'hackathons won (distinct contracts holding a winner token)',
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
// the UI; these change what a reader should expect from a score. Uncounted
// credentials don't need one — their `status_reason` is the note.
const DISPLAY_NOTES: Record<string, string> = {
  github_repositories: 'Approximates production: public repo count vs. repos contributed-to.',
}

export function displayNote(c: SpecCredential): string | null {
  return DISPLAY_NOTES[c.slug] ?? null
}
