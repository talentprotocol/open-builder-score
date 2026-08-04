export type Conversion = 'no_conversion' | 'sqrt' | 'log' | 'timestamp_to_year'
export type Calculation = 'sum_all' | 'max_value'

// `active` credentials are the ones the engine scores. The other two are both
// "not counted" but for opposite reasons, and the distinction is the point:
// `deferred` means we want it and can't compute it yet, `excluded` means it is
// perfectly computable and we decided it isn't builder signal. Both carry a
// `status_reason` so the credentials reference can say which is which.
export type CredentialStatus = 'active' | 'deferred' | 'excluded'

export interface SpecCredential {
  slug: string
  name: string
  tier: string
  value: string
  max_score: number
  multiplier: number
  conversion: Conversion
  calculation: Calculation
  status: CredentialStatus
  status_reason?: string
  notes?: string
}

export interface Spec {
  name: string
  version: string
  constants: { SECONDS_IN_A_YEAR: number }
  credentials: SpecCredential[]
}

export interface RegistryContract { name: string; chain: string; address: string }
export interface RegistryCredential {
  method: string
  contracts?: RegistryContract[] | string
  call?: { function: string; result_index: number; divide_by: string }
  schema_uid?: string
  networks?: string[]
}
export interface Registry {
  version: string
  chains: Record<string, number>
  credentials: Record<string, RegistryCredential>
}

export type CredentialInput =
  | { status: 'ok'; accounts: number[] }        // one raw value per account (POC: single wallet)
  | { status: 'unavailable'; reason: string }

export interface EngineInputs {
  computedAt: number                            // unix seconds — the single "now"
  values: Record<string, CredentialInput>       // keyed by credential slug
}

export type CredentialState = 'earned' | 'not_earned' | 'unavailable'

export interface CredentialResult {
  slug: string
  name: string
  points: number
  maxScore: number
  rawValue: number | null      // sum_all: summed raw; max_value: the best account's raw
  converted: number | null
  formula: string              // e.g. "min(round(sqrt(900) × 0.03), 8) = 1", or "—"
  state: CredentialState
  unavailableReason?: string
}

export interface ScoreResult {
  total: number
  maxTotal: number
  perCredential: CredentialResult[]
  complete: boolean            // false if ANY credential is 'unavailable' — gates attestation
}

// --- Badges -----------------------------------------------------------------
// Zero-point achievements. They live alongside the score, never inside it:
// nothing here feeds computeScore, ScoreResult.complete, or the attestation.

// 'rpc'       — read live from a contract, per wallet
// 'allowlist' — membership in a frozen set derived from public chain history,
//               for contracts that cannot answer the question per wallet
// 'snapshot'  — membership in a dated export from Talent Protocol's database
//
// A badge may carry more than one check: `source` names its primary one, and
// `snapshot: true` adds a snapshot on top. Checks are OR-ed, so a badge earned
// by any one of them is earned.
export type BadgeSource = 'rpc' | 'allowlist' | 'snapshot'
export type BadgeCheck = BadgeSource
export type BadgeMethod = 'nonzero_address_call' | 'positive_uint_call'

export interface BadgeContract { name: string; chain: string; address: string }
export interface BadgeDefinition {
  slug: string
  name: string
  description: string
  source: BadgeSource
  method?: BadgeMethod
  call?: string
  contracts?: BadgeContract[]
  allowlist?: string
  snapshot?: boolean
  notes?: string
}

export interface Allowlist {
  slug: string
  source: string
  generator: string
  frozen_because: string
  chains: Record<string, { factory: string; events: number }>
  count: number
  talents: string[]
}
export interface BadgeSpec {
  version: string
  badges: BadgeDefinition[]
}

// Per-wallet outcome, before the OR across wallets.
export type BadgeInput =
  | { status: 'ok'; earned: boolean }
  | { status: 'unavailable'; reason: string }

export type BadgeState = 'earned' | 'not_earned' | 'unavailable'

export interface BadgeResult {
  slug: string
  name: string
  description: string
  source: BadgeSource
  state: BadgeState
  unavailableReason?: string
  asOf?: string | null          // snapshot badges only — the export date
}

export interface NftCredentialManifest {
  generated_at: string
  source: string
  generator: string
  frozen_because: string
  shards: number
  credentials: Record<
    string,
    {
      unit: string
      wallets: number
      tokens_scanned: number
      incomplete?: { address: string; chain: string; swept: number; holders: number }[]
      contracts: Record<string, { chain: string; tokens: number; owners?: number; source?: string; skipped?: string }>
    }
  >
}

export interface SnapshotMeta {
  generated_at: string | null   // null until the first export is published
  source: string
  shards: number
  badges: Record<string, { count: number; threshold?: number }>
}
