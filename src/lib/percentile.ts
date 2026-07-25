import specJson from '../../spec/spec.json'
import { ATTEST_SCHEMA_UID } from './eas'
import { decodeAttestationData, EASSCAN_GRAPHQL } from './verify'
import type { Spec } from './types'

const spec = specJson as Spec

export const CORPUS_PAGE_SIZE = 100
export const CORPUS_MAX_PAGES = 5 // hard cap: the 500 most recent attestations

// Revoked attestations are excluded server-side; newest-first so the cap
// keeps the most recent corpus.
export const CORPUS_PAGE_QUERY = `query($schema_id: String!, $take: Int!, $skip: Int!) {
  attestations(
    where: { schemaId: { equals: $schema_id }, revocationTime: { equals: 0 } }
    orderBy: [{ timeCreated: desc }]
    take: $take
    skip: $skip
  ) {
    id
    recipient
    timeCreated
    data
  }
}`

export const CORPUS_COUNT_QUERY = `query($schema_id: String!) {
  aggregateAttestation(
    where: { schemaId: { equals: $schema_id }, revocationTime: { equals: 0 } }
  ) {
    _count { _all }
  }
}`

export interface CorpusEntry {
  recipient: string // lowercased for per-wallet dedup
  score: number
  specVersion: string
  timeCreated: number
}

export function parseCorpusPage(raw: unknown): CorpusEntry[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const attestations = (raw as { data?: { attestations?: unknown } }).data?.attestations
  if (!Array.isArray(attestations)) return null
  const entries: CorpusEntry[] = []
  for (const item of attestations) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    if (typeof a.recipient !== 'string' || typeof a.data !== 'string') continue
    const decoded = decodeAttestationData(a.data as `0x${string}`)
    if (decoded === null) continue
    const timeCreated = Number(a.timeCreated ?? 0)
    if (!Number.isFinite(timeCreated)) continue
    entries.push({
      recipient: a.recipient.toLowerCase(),
      score: decoded.score,
      specVersion: decoded.specVersion,
      timeCreated,
    })
  }
  return entries
}

// One score per wallet — the most recent — and only scores computed on the
// current spec version (older-spec totals aren't comparable).
export function latestPerWallet(entries: CorpusEntry[]): number[] {
  const latest = new Map<string, CorpusEntry>()
  for (const e of entries) {
    if (e.specVersion !== spec.version) continue
    const prev = latest.get(e.recipient)
    if (!prev || e.timeCreated > prev.timeCreated) latest.set(e.recipient, e)
  }
  return [...latest.values()].map((e) => e.score)
}

export interface Percentile {
  countBelow: number
  corpusSize: number
  topPercent: number
  truncated: boolean
}

export function computePercentile(
  myScore: number,
  corpusScores: number[],
  truncated: boolean,
): Percentile | null {
  if (corpusScores.length === 0) return null
  const countBelow = corpusScores.filter((s) => s < myScore).length
  const topPercent = Math.max(
    1,
    Math.ceil(((corpusScores.length - countBelow) / corpusScores.length) * 100),
  )
  return { countBelow, corpusSize: corpusScores.length, topPercent, truncated }
}

export type PercentileResult =
  | { status: 'ok'; percentile: Percentile }
  | { status: 'empty' }
  | { status: 'error' }

async function postQuery(
  query: string,
  variables: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<unknown | null> {
  try {
    const response = await fetchFn(EASSCAN_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function fetchScorePercentile(
  myScore: number,
  fetchFn: typeof fetch = fetch,
): Promise<PercentileResult> {
  const entries: CorpusEntry[] = []
  let page = 0
  for (; page < CORPUS_MAX_PAGES; page++) {
    const raw = await postQuery(
      CORPUS_PAGE_QUERY,
      { schema_id: ATTEST_SCHEMA_UID, take: CORPUS_PAGE_SIZE, skip: page * CORPUS_PAGE_SIZE },
      fetchFn,
    )
    if (raw === null) return { status: 'error' }
    const parsed = parseCorpusPage(raw)
    if (parsed === null) return { status: 'error' }
    entries.push(...parsed)
    if (parsed.length < CORPUS_PAGE_SIZE) break
  }
  let truncated = page === CORPUS_MAX_PAGES
  if (truncated) {
    // The cheap server-side count makes the truncation note honest; if the
    // count itself fails, keep the pessimistic flag.
    const raw = await postQuery(CORPUS_COUNT_QUERY, { schema_id: ATTEST_SCHEMA_UID }, fetchFn)
    const count = (
      raw as { data?: { aggregateAttestation?: { _count?: { _all?: unknown } } } } | null
    )?.data?.aggregateAttestation?._count?._all
    if (typeof count === 'number') truncated = count > entries.length
  }
  const percentile = computePercentile(myScore, latestPerWallet(entries), truncated)
  return percentile === null ? { status: 'empty' } : { status: 'ok', percentile }
}
