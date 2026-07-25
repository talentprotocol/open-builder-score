# Percentile Among Attested Scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One quiet line on the results screen — "Higher than N of M attested Builder Scores · top P%" — computed in-browser from the public EAS index.

**Architecture:** A framework-free `percentile.ts` lib fetches the schema-wide attestation corpus from easscan GraphQL (paginated, capped at 500, revoked excluded server-side), decodes scores client-side with the existing `decodeAttestationData`, keeps the latest per wallet on the current spec version, and ranks strictly-below. A self-fetching component (pattern: `attestation-history.tsx`) renders the line or nothing.

**Tech Stack:** easscan GraphQL (`attestations` + `aggregateAttestation`), viem ABI decode (existing), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-percentile-design.md`

## Global Constraints

- Never add a `webpack:` key to `next.config.ts`; leave `turbopack.ignoreIssue` untouched.
- No new dependencies, no secrets, no env vars.
- These files stay byte-identical: `src/lib/verify.ts`, `history.ts`, `eas.ts`, `engine.ts`, `orchestrate.ts`, `routes.ts`, `chains.ts`, `github.ts`, `github-auth.ts`, `speedrun.ts`, `easscan.ts`, `ens.ts`.
- Corpus rules: revoked excluded server-side (`revocationTime: { equals: 0 }`); one score per wallet (latest `timeCreated`, recipients compared lowercased); only `decoded.specVersion === spec.version` counts; hard cap 500 rows (5 pages × 100) with the truncation flag verified against `aggregateAttestation._count` when the cap is hit.
- Ranking: strict-below; `topPercent = max(1, ceil((corpusSize − countBelow) / corpusSize × 100))`.
- Turbopack JSX gotcha (bit us in attest-panel): text wrapping to a new line after an `{expression}` loses its leading space — keep continuation text on the same line as the expression it follows, or use explicit `{' '}`.
- All 150 existing tests stay green. Visual language: dark zinc + emerald.
- Known transient: stale `.next/dev/types` typecheck errors while the dev server runs → `npm run build` once, retry. Never run `npm run dev`.
- Work happens on branch `feat/percentile`.

---

### Task 1: Percentile lib

**Files:**
- Create: `src/lib/percentile.ts`
- Test: `test/percentile.test.ts`

**Interfaces:**
- Consumes: `decodeAttestationData`, `EASSCAN_GRAPHQL` from `@/lib/verify`; `ATTEST_SCHEMA_UID` from `@/lib/eas`; `spec.version` via the `spec/spec.json` import.
- Produces (consumed by Task 2): `fetchScorePercentile(myScore: number, fetchFn?: typeof fetch): Promise<PercentileResult>`; types `Percentile { countBelow, corpusSize, topPercent, truncated }`, `PercentileResult = { status: 'ok'; percentile: Percentile } | { status: 'empty' } | { status: 'error' }`; also exported for tests: `CORPUS_PAGE_SIZE`, `CORPUS_MAX_PAGES`, `CORPUS_PAGE_QUERY`, `CORPUS_COUNT_QUERY`, `parseCorpusPage`, `latestPerWallet`, `computePercentile`, `CorpusEntry`.

- [ ] **Step 1: Write the failing tests**

Create `test/percentile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import specJson from '../spec/spec.json'
import {
  computePercentile,
  CORPUS_MAX_PAGES,
  CORPUS_PAGE_SIZE,
  fetchScorePercentile,
  latestPerWallet,
  parseCorpusPage,
  type CorpusEntry,
} from '@/lib/percentile'

const PARAMS = parseAbiParameters(
  'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number',
)

function encodedData(score: number, specVersion: string = specJson.version): `0x${string}` {
  return encodeAbiParameters(PARAMS, [
    specVersion,
    '0x0000000000000000000000000000000000000001',
    '',
    score,
    1n,
    2n,
  ])
}

function row(recipient: string, score: number, timeCreated: number, specVersion?: string) {
  return { id: `uid-${recipient}-${timeCreated}`, recipient, timeCreated, data: encodedData(score, specVersion) }
}

function pageResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ data: { attestations: rows } }), { status: 200 })
}

const entry = (recipient: string, score: number, timeCreated: number, specVersion: string = specJson.version): CorpusEntry => ({
  recipient,
  score,
  specVersion,
  timeCreated,
})

describe('parseCorpusPage', () => {
  it('parses rows and lowercases recipients', () => {
    const parsed = parseCorpusPage({ data: { attestations: [row('0xAbC0000000000000000000000000000000000001', 141, 10)] } })
    expect(parsed).toEqual([entry('0xabc0000000000000000000000000000000000001', 141, 10)])
  })
  it('skips junk rows and undecodable data, keeps the rest', () => {
    const parsed = parseCorpusPage({
      data: {
        attestations: [
          42,
          { id: 'x', recipient: '0xA', data: '0xdeadbeef' },
          row('0xB', 103, 5),
        ],
      },
    })
    expect(parsed).toEqual([entry('0xb', 103, 5)])
  })
  it('returns null on a malformed root', () => {
    expect(parseCorpusPage(null)).toBeNull()
    expect(parseCorpusPage({ data: {} })).toBeNull()
    expect(parseCorpusPage({ errors: [{ message: 'nope' }] })).toBeNull()
  })
})

describe('latestPerWallet', () => {
  it('keeps only the newest score per wallet', () => {
    expect(
      latestPerWallet([entry('0xa', 103, 5), entry('0xa', 141, 10), entry('0xb', 20, 7)]).sort((x, y) => x - y),
    ).toEqual([20, 141])
  })
  it('drops entries from other spec versions', () => {
    expect(latestPerWallet([entry('0xa', 141, 10), entry('0xb', 999, 20, '9.9.9')])).toEqual([141])
  })
})

describe('computePercentile', () => {
  it('returns null for an empty corpus', () => {
    expect(computePercentile(141, [], false)).toBeNull()
  })
  it('counts strictly below — ties are not beaten', () => {
    expect(computePercentile(141, [103, 141, 200], false)).toEqual({
      countBelow: 1,
      corpusSize: 3,
      topPercent: 67,
      truncated: false,
    })
  })
  it('floors topPercent at 1 when above everyone', () => {
    const scores = Array.from({ length: 200 }, (_, i) => i)
    expect(computePercentile(999, scores, true)).toEqual({
      countBelow: 200,
      corpusSize: 200,
      topPercent: 1,
      truncated: true,
    })
  })
})

describe('fetchScorePercentile', () => {
  it('single short page: ok, not truncated', async () => {
    const calls: string[] = []
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(String(init?.body))
      return pageResponse([row('0xA', 141, 10), row('0xB', 103, 5)])
    }) as typeof fetch
    const result = await fetchScorePercentile(120, fakeFetch)
    expect(result).toEqual({
      status: 'ok',
      percentile: { countBelow: 1, corpusSize: 2, topPercent: 50, truncated: false },
    })
    expect(calls).toHaveLength(1)
  })
  it('paginates until a short page', async () => {
    const fullPage = Array.from({ length: CORPUS_PAGE_SIZE }, (_, i) => row(`0xfull${i}`, i, 1000 + i))
    let call = 0
    const fakeFetch = (async () => {
      call++
      return call === 1 ? pageResponse(fullPage) : pageResponse([row('0xlast', 50, 1)])
    }) as typeof fetch
    const result = await fetchScorePercentile(0, fakeFetch)
    expect(call).toBe(2)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.percentile.corpusSize).toBe(CORPUS_PAGE_SIZE + 1)
      expect(result.percentile.truncated).toBe(false)
    }
  })
  it('cap hit: consults the count query and reports truncation honestly', async () => {
    let pageCalls = 0
    let countCalls = 0
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body)
      if (body.includes('aggregateAttestation')) {
        countCalls++
        return new Response(
          JSON.stringify({ data: { aggregateAttestation: { _count: { _all: 9999 } } } }),
          { status: 200 },
        )
      }
      pageCalls++
      const base = pageCalls * 100000
      return pageResponse(
        Array.from({ length: CORPUS_PAGE_SIZE }, (_, i) => row(`0xp${pageCalls}n${i}`, 10, base + i)),
      )
    }) as typeof fetch
    const result = await fetchScorePercentile(999, fakeFetch)
    expect(pageCalls).toBe(CORPUS_MAX_PAGES)
    expect(countCalls).toBe(1)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.percentile.corpusSize).toBe(CORPUS_MAX_PAGES * CORPUS_PAGE_SIZE)
      expect(result.percentile.truncated).toBe(true)
    }
  })
  it('empty corpus maps to empty', async () => {
    const fakeFetch = (async () => pageResponse([])) as typeof fetch
    expect(await fetchScorePercentile(141, fakeFetch)).toEqual({ status: 'empty' })
  })
  it('HTTP and network failures map to error', async () => {
    const httpFail = (async () => new Response('{}', { status: 500 })) as typeof fetch
    expect(await fetchScorePercentile(141, httpFail)).toEqual({ status: 'error' })
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect(await fetchScorePercentile(141, netFail)).toEqual({ status: 'error' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/percentile.test.ts`
Expected: FAIL — cannot resolve `@/lib/percentile`.

- [ ] **Step 3: Implement**

Create `src/lib/percentile.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/percentile.test.ts` → PASS (13 tests).
Run: `npm test` → 163 tests. `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/percentile.ts test/percentile.test.ts
git commit -m "feat: percentile-among-attested lib over easscan GraphQL"
```

---

### Task 2: Component + results wiring

**Files:**
- Create: `src/components/score-percentile.tsx`
- Modify: `src/app/score/[wallet]/page.tsx`

**Interfaces:**
- Consumes: `fetchScorePercentile`, `Percentile` from Task 1.

- [ ] **Step 1: Create the component**

Create `src/components/score-percentile.tsx` (note: continuation text stays on the same line as the expression it follows, or uses `{' '}` — the Turbopack JSX gotcha from the Global Constraints):

```tsx
'use client'

import { useEffect, useState } from 'react'
import { fetchScorePercentile, type Percentile } from '@/lib/percentile'

// Self-fetching, like AttestationHistory: renders nothing while loading, on
// error, or when no comparable attestation corpus exists yet.
export function ScorePercentile({ score }: { score: number }) {
  const [percentile, setPercentile] = useState<Percentile | null>(null)

  useEffect(() => {
    let cancelled = false
    setPercentile(null)
    ;(async () => {
      const result = await fetchScorePercentile(score)
      if (!cancelled && result.status === 'ok') setPercentile(result.percentile)
    })()
    return () => {
      cancelled = true
    }
  }, [score])

  if (percentile === null) return null
  return (
    <p className="text-xs text-zinc-500">
      Higher than {percentile.countBelow} of {percentile.corpusSize} attested Builder{' '}
      {percentile.corpusSize === 1 ? 'Score' : 'Scores'} · top {percentile.topPercent}%
      {percentile.truncated && ' · based on the most recent 500'}
    </p>
  )
}
```

- [ ] **Step 2: Wire into the results page**

In `src/app/score/[wallet]/page.tsx`, add the import:

```tsx
import { ScorePercentile } from '@/components/score-percentile'
```

and directly after the closing `</div>` of the address block (the `div` that wraps the primary address line and the `+ extra` lines), add:

```tsx
          <ScorePercentile score={state.scored.score.total} />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 163 tests. `npm run build` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/score-percentile.tsx 'src/app/score/[wallet]/page.tsx'
git commit -m "feat: percentile line on the results screen"
```

---

## Post-plan validation (coordinator, not a task)

Browser pass on the results page: the line renders under the address block ("Higher than 0 of 1 attested Builder Score · top 100%" against today's corpus — both live attestations belong to the same wallet, latest wins); no line on error/empty; verify the network tab shows one corpus query (small corpus, no count query). Then merge, push, redeploy, re-smoke prod.
