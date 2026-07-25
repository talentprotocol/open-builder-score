import { getAddress } from 'viem'
import { ATTEST_SCHEMA_UID } from './eas'
import { decodeAttestationData, EASSCAN_GRAPHQL } from './verify'

// Newest-first Builder Score attestations for one wallet, decoded client-side.
export const HISTORY_QUERY = `query($recipient: String!, $schema_id: String!) {
  attestations(
    where: { recipient: { equals: $recipient }, schemaId: { equals: $schema_id } }
    orderBy: [{ timeCreated: desc }]
    take: 20
  ) {
    id
    revocationTime
    timeCreated
    data
  }
}`

export interface ScoreAttestationSummary {
  uid: string
  score: number
  specVersion: string
  timeCreated: number
  revoked: boolean
}

export type HistoryResult =
  | { status: 'ok'; attestations: ScoreAttestationSummary[] }
  | { status: 'error' }

export function parseHistoryResponse(raw: unknown): HistoryResult {
  if (typeof raw !== 'object' || raw === null) return { status: 'error' }
  const attestations = (raw as { data?: { attestations?: unknown } }).data?.attestations
  if (!Array.isArray(attestations)) return { status: 'error' }
  const summaries: ScoreAttestationSummary[] = []
  for (const item of attestations) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    if (typeof a.id !== 'string' || typeof a.data !== 'string') continue
    const decoded = decodeAttestationData(a.data as `0x${string}`)
    if (decoded === null) continue
    const revocationTime = Number(a.revocationTime ?? 0)
    const timeCreated = Number(a.timeCreated ?? 0)
    if (!Number.isFinite(revocationTime) || !Number.isFinite(timeCreated)) continue
    summaries.push({
      uid: a.id,
      score: decoded.score,
      specVersion: decoded.specVersion,
      timeCreated,
      revoked: revocationTime !== 0,
    })
  }
  return { status: 'ok', attestations: summaries }
}

export async function fetchScoreAttestationHistory(
  wallet: string,
  fetchFn: typeof fetch = fetch,
): Promise<HistoryResult> {
  let recipient: string
  try {
    recipient = getAddress(wallet) // easscan stores checksummed recipients
  } catch {
    return { status: 'error' }
  }
  try {
    const response = await fetchFn(EASSCAN_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: HISTORY_QUERY,
        variables: { recipient, schema_id: ATTEST_SCHEMA_UID },
      }),
    })
    if (!response.ok) return { status: 'error' }
    return parseHistoryResponse(await response.json())
  } catch {
    return { status: 'error' }
  }
}
