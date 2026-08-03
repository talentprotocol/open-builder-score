import { decodeAbiParameters, getAddress, parseAbiParameters } from 'viem'
import specJson from '../../spec/spec.json'
import { ATTEST_SCHEMA, ATTEST_SCHEMA_UID, EASSCAN_SITE } from './eas'
import type { ScoreResult, Spec } from './types'

const spec = specJson as Spec

export const EASSCAN_GRAPHQL = `${EASSCAN_SITE}/graphql`

// Derived from the canonical schema string so the decoder can never drift from eas.ts.
const SCHEMA_PARAMS = parseAbiParameters(ATTEST_SCHEMA)

export const ATTESTATION_QUERY = `query($id: String!) {
  attestation(where: { id: $id }) {
    id
    schemaId
    recipient
    attester
    revocationTime
    timeCreated
    data
  }
}`

export interface OnchainAttestation {
  uid: string
  schemaId: string
  recipient: string
  attester: string
  revocationTime: number
  timeCreated: number
  data: `0x${string}`
}

export interface DecodedScoreAttestation {
  specVersion: string
  wallet: `0x${string}`
  githubHandle: string | null
  score: number
  computedAt: number
  blockNumber: bigint
}

export type FetchAttestationResult =
  | { status: 'found'; attestation: OnchainAttestation }
  | { status: 'not_found' }
  | { status: 'error'; reason: string }

export type VerifyVerdict = 'match' | 'diverged' | 'incomplete'

export function isAttestationUid(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function parseAttestationResponse(raw: unknown): FetchAttestationResult {
  const unexpected = { status: 'error', reason: 'easscan returned an unexpected shape' } as const
  if (typeof raw !== 'object' || raw === null) return unexpected
  const errors = (raw as { errors?: unknown }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    const message = (errors[0] as { message?: unknown })?.message
    const reason =
      typeof message === 'string' ? `easscan: ${message}` : 'easscan returned an error'
    return { status: 'error', reason }
  }
  const att = (raw as { data?: { attestation?: unknown } }).data?.attestation
  if (att === null) return { status: 'not_found' }
  if (typeof att !== 'object' || att === undefined) return unexpected
  const a = att as Record<string, unknown>
  if (
    typeof a.id !== 'string' ||
    typeof a.schemaId !== 'string' ||
    typeof a.recipient !== 'string' ||
    typeof a.attester !== 'string' ||
    typeof a.data !== 'string'
  ) {
    return unexpected
  }
  const revocationTime = Number(a.revocationTime ?? 0)
  const timeCreated = Number(a.timeCreated ?? 0)
  if (!Number.isFinite(revocationTime) || !Number.isFinite(timeCreated)) return unexpected
  return {
    status: 'found',
    attestation: {
      uid: a.id,
      schemaId: a.schemaId,
      recipient: a.recipient,
      attester: a.attester,
      revocationTime,
      timeCreated,
      data: a.data as `0x${string}`,
    },
  }
}

export async function fetchAttestation(
  uid: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchAttestationResult> {
  try {
    const response = await fetchFn(EASSCAN_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ATTESTATION_QUERY, variables: { id: uid } }),
    })
    if (!response.ok) return { status: 'error', reason: `easscan ${response.status}` }
    return parseAttestationResponse(await response.json())
  } catch {
    return { status: 'error', reason: 'easscan unreachable' }
  }
}

export function decodeAttestationData(data: `0x${string}`): DecodedScoreAttestation | null {
  try {
    const [specVersion, wallet, githubHandle, score, computedAt, blockNumber] =
      decodeAbiParameters(SCHEMA_PARAMS, data)
    return {
      specVersion,
      wallet,
      githubHandle: githubHandle === '' ? null : githubHandle,
      score,
      computedAt: Number(computedAt),
      blockNumber,
    }
  } catch {
    return null
  }
}

// Static integrity checks that don't require recomputation. Empty array = valid.
export function validateAttestation(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation | null,
): string[] {
  const problems: string[] = []
  if (att.schemaId.toLowerCase() !== ATTEST_SCHEMA_UID.toLowerCase()) {
    problems.push('attestation uses a different schema — not a Builder Score attestation')
  }
  if (decoded === null) {
    problems.push('attestation data does not decode as a Builder Score')
    return problems
  }
  try {
    if (getAddress(att.recipient) !== getAddress(decoded.wallet)) {
      problems.push('recipient does not match the attested wallet')
    }
  } catch {
    problems.push('recipient is not a valid address')
  }
  return problems
}

// EAS records the attester as msg.sender, so a self-attested record is proof
// the scored wallet signed for itself — permissionlessly checkable, which is
// exactly what a browser-only message signature would not be.
//
// Deliberately kept out of classifyAttestation and scoreVerdict: attestations
// made before the attest-time ownership gate legitimately have
// attester !== wallet, and retroactively calling those malformed would be
// wrong. Score correctness and wallet ownership are independent facts.
export function isSelfAttested(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation,
): boolean {
  try {
    return getAddress(att.attester) === getAddress(decoded.wallet)
  } catch {
    return false
  }
}

export type AttestationClassification =
  | { kind: 'malformed'; problems: string[] }
  | { kind: 'revoked'; decoded: DecodedScoreAttestation }
  | { kind: 'spec_mismatch'; decoded: DecodedScoreAttestation }
  | { kind: 'ok'; decoded: DecodedScoreAttestation }

// Precedence: integrity problems > revoked > spec mismatch > ok.
export function classifyAttestation(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation | null,
): AttestationClassification {
  const problems = validateAttestation(att, decoded)
  if (problems.length > 0 || decoded === null) return { kind: 'malformed', problems }
  if (att.revocationTime !== 0) return { kind: 'revoked', decoded }
  if (decoded.specVersion !== spec.version) return { kind: 'spec_mismatch', decoded }
  return { kind: 'ok', decoded }
}

export function scoreVerdict(attestedScore: number, recomputed: ScoreResult): VerifyVerdict {
  if (!recomputed.complete) return 'incomplete'
  return recomputed.total === attestedScore ? 'match' : 'diverged'
}
