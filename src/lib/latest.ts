import { ATTEST_AGGREGATE_SCHEMA_UID } from './eas'
import { decodeAttestationData, EASSCAN_GRAPHQL } from './verify'

// The newest aggregate attestations across all wallets, decoded client-side.
// Current schema only: older generations still verify on /verify/[uid], but a
// discovery feed shows what the app writes today, not the archive. Revoked rows
// are excluded at the source — a stranger's retracted claim is noise here,
// unlike in a wallet's own history where it is part of the record.
export const LATEST_TAKE = 20

export const LATEST_QUERY = `query($schema_id: String!, $take: Int!) {
  attestations(
    where: { schemaId: { equals: $schema_id }, revocationTime: { equals: 0 } }
    orderBy: [{ timeCreated: desc }]
    take: $take
  ) {
    id
    recipient
    timeCreated
    data
  }
}`

export interface LatestAttestation {
  uid: string
  /** Checksummed, as easscan stores it. */
  recipient: string
  score: number
  specVersion: string
  walletCount: number
  timeCreated: number
}

export type LatestResult =
  | { status: 'ok'; attestations: LatestAttestation[] }
  | { status: 'error' }

export function parseLatestResponse(raw: unknown): LatestResult {
  if (typeof raw !== 'object' || raw === null) return { status: 'error' }
  const attestations = (raw as { data?: { attestations?: unknown } }).data?.attestations
  if (!Array.isArray(attestations)) return { status: 'error' }
  const summaries: LatestAttestation[] = []
  for (const item of attestations) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    if (typeof a.id !== 'string' || typeof a.recipient !== 'string') continue
    if (typeof a.data !== 'string') continue
    // The query pins one schemaId, so decode under exactly that schema — a blob
    // that doesn't decode is skipped, never guessed at.
    const decoded = decodeAttestationData(a.data as `0x${string}`, ATTEST_AGGREGATE_SCHEMA_UID)
    if (decoded === null) continue
    const timeCreated = Number(a.timeCreated ?? 0)
    if (!Number.isFinite(timeCreated)) continue
    summaries.push({
      uid: a.id,
      recipient: a.recipient,
      score: decoded.score,
      specVersion: decoded.specVersion,
      walletCount: 1 + decoded.extraWallets.length,
      timeCreated,
    })
  }
  return { status: 'ok', attestations: summaries }
}

export async function fetchLatestAttestations(
  fetchFn: typeof fetch = fetch,
  options: { take?: number } = {},
): Promise<LatestResult> {
  try {
    const response = await fetchFn(EASSCAN_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: LATEST_QUERY,
        variables: { schema_id: ATTEST_AGGREGATE_SCHEMA_UID, take: options.take ?? LATEST_TAKE },
      }),
    })
    if (!response.ok) return { status: 'error' }
    return parseLatestResponse(await response.json())
  } catch {
    return { status: 'error' }
  }
}
