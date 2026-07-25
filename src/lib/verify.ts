import { decodeAbiParameters, getAddress } from 'viem'
import specJson from '../../spec/spec.json'
import { ATTEST_CHAIN_ID, ATTEST_SCHEMA_UID } from './eas'
import type { ScoreResult, Spec } from './types'

const spec = specJson as Spec

export const EASSCAN_SITE =
  ATTEST_CHAIN_ID === 84532
    ? 'https://base-sepolia.easscan.org'
    : 'https://base.easscan.org'

export const EASSCAN_GRAPHQL = `${EASSCAN_SITE}/graphql`

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
      decodeAbiParameters(
        [
          { type: 'string' },
          { type: 'address' },
          { type: 'string' },
          { type: 'uint16' },
          { type: 'uint64' },
          { type: 'uint64' },
        ],
        data,
      )
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
  if (att.revocationTime !== 0) {
    problems.push('attestation has been revoked')
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
  if (decoded.specVersion !== spec.version) {
    problems.push(
      `attested with spec v${decoded.specVersion}; this app recomputes spec v${spec.version}, so an exact comparison isn't possible`,
    )
  }
  return problems
}

export function scoreVerdict(attestedScore: number, recomputed: ScoreResult): VerifyVerdict {
  if (!recomputed.complete) return 'incomplete'
  return recomputed.total === attestedScore ? 'match' : 'diverged'
}
