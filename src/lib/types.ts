export type Conversion = 'no_conversion' | 'sqrt' | 'log' | 'timestamp_to_year'
export type Calculation = 'sum_all' | 'max_value'

export interface SpecCredential {
  slug: string
  name: string
  tier: string
  value: string
  max_score: number
  multiplier: number
  conversion: Conversion
  calculation: Calculation
  poc: boolean
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
