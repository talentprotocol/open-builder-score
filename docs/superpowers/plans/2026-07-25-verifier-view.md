# Verifier View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/verify` flow that fetches a Builder Score attestation by UID, recomputes the score in-browser, and renders match / diverged / incomplete / invalid verdicts.

**Architecture:** A framework-free `src/lib/verify.ts` does the easscan lookup, ABI decode, static integrity checks, and verdict logic (all unit-tested with injectable fetch). Two client pages mirror the existing `/score` patterns; a server segment layout carries metadata. Entry links from the footer and the attest panel's success state.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, viem (`decodeAbiParameters`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-verifier-view-design.md`

## Global Constraints

- Never add a `webpack:` key to `next.config.ts`; leave its `turbopack.ignoreIssue` block untouched.
- No new dependencies. Zero secrets, zero env vars.
- URL shapes are defined **only** in `src/lib/routes.ts` — screens use `scorePath`/`inputPath`/`verifyPath`, never hand-built strings.
- In Next 16, page `params` props are Promises; client pages unwrap with React's `use()`.
- `"use client"` pages cannot export `metadata`; the `/verify` segment layout (server) carries it.
- No changes to `src/lib/engine.ts`, `chains.ts`, `github.ts`, `easscan.ts`, `speedrun.ts`, `orchestrate.ts`, `eas.ts`. `credential-card.tsx` unchanged.
- All 78 existing tests stay green; this plan adds tests in `test/verify.test.ts` and `test/routes.test.ts`.
- Visuals: dark zinc + emerald aesthetic (`border-zinc-700/800`, `text-zinc-400/500/600`, `bg-emerald-600` buttons, `text-emerald-400` links, amber for partial states).
- Work happens on branch `feat/verifier`.

---

### Task 1: Verify lib

**Files:**
- Create: `src/lib/verify.ts`
- Test: `test/verify.test.ts`

**Interfaces:**
- Consumes: `ATTEST_CHAIN_ID`, `ATTEST_SCHEMA_UID` from `./eas`; `ScoreResult`, `Spec` from `./types`; `spec/spec.json`; viem `decodeAbiParameters`, `getAddress`.
- Produces (Task 3 imports all of these from `@/lib/verify`): `isAttestationUid(value: string): boolean`; `fetchAttestation(uid: string, fetchFn?: typeof fetch): Promise<FetchAttestationResult>`; `decodeAttestationData(data: \`0x${string}\`): DecodedScoreAttestation | null`; `validateAttestation(att: OnchainAttestation, decoded: DecodedScoreAttestation | null): string[]`; `scoreVerdict(attestedScore: number, recomputed: ScoreResult): VerifyVerdict`; types `OnchainAttestation`, `DecodedScoreAttestation`, `FetchAttestationResult`, `VerifyVerdict`.

- [ ] **Step 1: Write the failing tests**

Create `test/verify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, zeroAddress } from 'viem'
import {
  ATTESTATION_QUERY,
  decodeAttestationData,
  fetchAttestation,
  isAttestationUid,
  parseAttestationResponse,
  scoreVerdict,
  validateAttestation,
  type OnchainAttestation,
} from '@/lib/verify'
import { ATTEST_SCHEMA_UID } from '@/lib/eas'
import specJson from '../spec/spec.json'
import type { ScoreResult, Spec } from '@/lib/types'

const spec = specJson as Spec

const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const UID = `0x${'ab'.repeat(32)}`

function encodeData(overrides: Partial<{
  specVersion: string
  wallet: `0x${string}`
  githubHandle: string
  score: number
  computedAt: bigint
  blockNumber: bigint
}> = {}): `0x${string}` {
  const v = {
    specVersion: spec.version,
    wallet: WALLET,
    githubHandle: 'octocat',
    score: 103,
    computedAt: 1784975866n,
    blockNumber: 49093260n,
    ...overrides,
  }
  return encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'address' },
      { type: 'string' },
      { type: 'uint16' },
      { type: 'uint64' },
      { type: 'uint64' },
    ],
    [v.specVersion, v.wallet, v.githubHandle, v.score, v.computedAt, v.blockNumber],
  )
}

function attestation(overrides: Partial<OnchainAttestation> = {}): OnchainAttestation {
  return {
    uid: UID,
    schemaId: ATTEST_SCHEMA_UID,
    recipient: WALLET,
    attester: WALLET,
    revocationTime: 0,
    timeCreated: 1784975900,
    data: encodeData(),
    ...overrides,
  }
}

function scoreResult(total: number, complete: boolean): ScoreResult {
  return { total, maxTotal: 257, perCredential: [], complete }
}

describe('isAttestationUid', () => {
  it('accepts 0x + 64 hex chars', () => {
    expect(isAttestationUid(UID)).toBe(true)
  })
  it('rejects wrong lengths and non-hex', () => {
    expect(isAttestationUid('0x1234')).toBe(false)
    expect(isAttestationUid(`0x${'gg'.repeat(32)}`)).toBe(false)
    expect(isAttestationUid(WALLET)).toBe(false)
  })
})

describe('decodeAttestationData', () => {
  it('round-trips the schema fields', () => {
    const decoded = decodeAttestationData(encodeData())
    expect(decoded).toEqual({
      specVersion: spec.version,
      wallet: WALLET,
      githubHandle: 'octocat',
      score: 103,
      computedAt: 1784975866,
      blockNumber: 49093260n,
    })
  })
  it('maps an empty github handle to null', () => {
    expect(decodeAttestationData(encodeData({ githubHandle: '' }))?.githubHandle).toBeNull()
  })
  it('returns null on undecodable data', () => {
    expect(decodeAttestationData('0x1234')).toBeNull()
  })
})

describe('validateAttestation', () => {
  it('passes a clean attestation', () => {
    const att = attestation()
    expect(validateAttestation(att, decodeAttestationData(att.data))).toEqual([])
  })
  it('flags a foreign schema', () => {
    const att = attestation({ schemaId: `0x${'00'.repeat(32)}` })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('different schema'))).toBe(true)
  })
  it('flags a revoked attestation', () => {
    const att = attestation({ revocationTime: 1784976000 })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('revoked'))).toBe(true)
  })
  it('flags undecodable data', () => {
    const att = attestation({ data: '0x1234' })
    expect(validateAttestation(att, null).some((p) => p.includes('decode'))).toBe(true)
  })
  it('flags recipient / wallet mismatch', () => {
    const att = attestation({ recipient: zeroAddress })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('recipient'))).toBe(true)
  })
  it('flags a spec version mismatch', () => {
    const att = attestation({ data: encodeData({ specVersion: '9.9.9' }) })
    const problems = validateAttestation(att, decodeAttestationData(att.data))
    expect(problems.some((p) => p.includes('spec'))).toBe(true)
  })
})

describe('scoreVerdict', () => {
  it('match when complete and equal', () => {
    expect(scoreVerdict(103, scoreResult(103, true))).toBe('match')
  })
  it('diverged when complete and different', () => {
    expect(scoreVerdict(103, scoreResult(90, true))).toBe('diverged')
  })
  it('incomplete when any source was unavailable', () => {
    expect(scoreVerdict(103, scoreResult(103, false))).toBe('incomplete')
  })
})

describe('parseAttestationResponse', () => {
  it('finds an attestation', () => {
    const raw = { data: { attestation: { id: UID, schemaId: ATTEST_SCHEMA_UID, recipient: WALLET, attester: WALLET, revocationTime: 0, timeCreated: 1, data: '0x' } } }
    const result = parseAttestationResponse(raw)
    expect(result.status).toBe('found')
  })
  it('maps null attestation to not_found', () => {
    expect(parseAttestationResponse({ data: { attestation: null } }).status).toBe('not_found')
  })
  it('maps junk shapes to error', () => {
    expect(parseAttestationResponse(null).status).toBe('error')
    expect(parseAttestationResponse({ data: {} }).status).toBe('error')
    expect(parseAttestationResponse({ data: { attestation: { id: 42 } } }).status).toBe('error')
  })
})

describe('fetchAttestation', () => {
  it('posts the query and parses a found attestation', async () => {
    let captured: { url: string; body: string } | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body) }
      return new Response(
        JSON.stringify({ data: { attestation: { id: UID, schemaId: ATTEST_SCHEMA_UID, recipient: WALLET, attester: WALLET, revocationTime: 0, timeCreated: 1, data: '0x' } } }),
        { status: 200 },
      )
    }) as typeof fetch
    const result = await fetchAttestation(UID, fakeFetch)
    expect(result.status).toBe('found')
    expect(captured!.body).toContain(UID)
    expect(captured!.body).toContain(ATTESTATION_QUERY.slice(0, 20))
  })
  it('maps HTTP errors to error', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect((await fetchAttestation(UID, fakeFetch)).status).toBe('error')
  })
  it('maps network failures to error', async () => {
    const fakeFetch = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await fetchAttestation(UID, fakeFetch)).status).toBe('error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/verify.test.ts`
Expected: FAIL — cannot resolve `@/lib/verify`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/verify.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/verify.test.ts`
Expected: PASS (18 tests).

Run: `npm test`
Expected: 96 tests pass (78 existing + 18 new).

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/verify.ts test/verify.test.ts
git commit -m "feat: attestation verify lib (fetch, decode, validate, verdict)"
```

---

### Task 2: `verifyPath` route helper

**Files:**
- Modify: `src/lib/routes.ts`
- Test: `test/routes.test.ts`

**Interfaces:**
- Produces: `verifyPath(uid: string | null = null): string` — `/verify` bare, `/verify/<uid>` with a uid. Tasks 3–4 import it from `@/lib/routes`.

- [ ] **Step 1: Write the failing tests**

Append to `test/routes.test.ts` (add `verifyPath` to the existing import from `@/lib/routes`):

```ts
describe('verifyPath', () => {
  it('is bare /verify with no uid', () => {
    expect(verifyPath()).toBe('/verify')
    expect(verifyPath(null)).toBe('/verify')
  })

  it('builds the deep link with a uid', () => {
    const uid = `0x${'ab'.repeat(32)}`
    expect(verifyPath(uid)).toBe(`/verify/${uid}`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/routes.test.ts`
Expected: FAIL — `verifyPath` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/routes.ts`:

```ts
export function verifyPath(uid: string | null = null): string {
  return uid ? `/verify/${uid}` : '/verify'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes.test.ts`
Expected: PASS (10 tests). Then `npm test` → 98 tests, `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routes.ts test/routes.test.ts
git commit -m "feat: verifyPath route helper"
```

---

### Task 3: Verify pages

**Files:**
- Create: `src/app/verify/layout.tsx`
- Create: `src/app/verify/page.tsx`
- Create: `src/app/verify/[uid]/page.tsx`

**Interfaces:**
- Consumes: everything Task 1 produces from `@/lib/verify`; `verifyPath`, `scorePath` from `@/lib/routes`; `gatherInputs` from `@/lib/orchestrate`; `computeScore` from `@/lib/engine`; `ATTEST_CHAIN_ID` from `@/lib/eas`; `CredentialCard`.
- Produces: the `/verify` and `/verify/[uid]` screens Task 4 links to.

- [ ] **Step 1: Create the segment layout (metadata carrier)**

Create `src/app/verify/layout.tsx`:

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Verify a Builder Score attestation',
  description:
    'Paste an attestation UID: your browser fetches it, recomputes the score from public data, and compares the two.',
}

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children
}
```

- [ ] **Step 2: Create the UID input page**

Create `src/app/verify/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAttestationUid } from '@/lib/verify'
import { verifyPath } from '@/lib/routes'

export default function VerifyPage() {
  const router = useRouter()
  const [uidInput, setUidInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const uid = uidInput.trim()
    if (!isAttestationUid(uid)) {
      setError('That doesn’t look like an attestation UID (0x…, 64 hex chars).')
      return
    }
    setError(null)
    router.push(verifyPath(uid))
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Verify an attestation</h1>
        <p className="text-sm text-zinc-400">
          Paste a Builder Score attestation UID. Your browser fetches the attestation, recomputes
          the score from public data, and compares the two.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="uid" className="text-xs font-medium text-zinc-400">
            Attestation UID
          </label>
          <input
            id="uid"
            value={uidInput}
            onChange={(e) => setUidInput(e.target.value)}
            placeholder="0x…"
            className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium">
          Verify
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Create the verdict page**

Create `src/app/verify/[uid]/page.tsx`:

```tsx
'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs } from '@/lib/orchestrate'
import {
  decodeAttestationData,
  EASSCAN_SITE,
  fetchAttestation,
  isAttestationUid,
  scoreVerdict,
  validateAttestation,
  type DecodedScoreAttestation,
  type OnchainAttestation,
  type VerifyVerdict,
} from '@/lib/verify'
import type { ScoreResult, Spec } from '@/lib/types'
import { scorePath, verifyPath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'

const spec = specJson as Spec

type State =
  | { phase: 'loading'; step: string }
  | { phase: 'invalid'; problems: string[] }
  | {
      phase: 'done'
      verdict: VerifyVerdict
      attestation: OnchainAttestation
      decoded: DecodedScoreAttestation
      recomputed: ScoreResult
    }

export default function VerifyUidPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid: rawUid } = use(params)
  const uid = rawUid.trim()

  const [state, setState] = useState<State>({ phase: 'loading', step: 'Fetching attestation…' })

  useEffect(() => {
    if (!isAttestationUid(uid)) {
      setState({
        phase: 'invalid',
        problems: ['not a valid attestation UID (0x…, 64 hex chars)'],
      })
      return
    }
    let cancelled = false
    setState({ phase: 'loading', step: 'Fetching attestation…' })
    ;(async () => {
      const fetched = await fetchAttestation(uid)
      if (cancelled) return
      if (fetched.status === 'not_found') {
        setState({ phase: 'invalid', problems: ['no attestation found with this UID'] })
        return
      }
      if (fetched.status === 'error') {
        setState({ phase: 'invalid', problems: [fetched.reason] })
        return
      }
      const decoded = decodeAttestationData(fetched.attestation.data)
      const problems = validateAttestation(fetched.attestation, decoded)
      if (problems.length > 0 || decoded === null) {
        setState({ phase: 'invalid', problems })
        return
      }
      setState({ phase: 'loading', step: 'Recomputing the score from public data…' })
      try {
        const gather = await gatherInputs(decoded.wallet, decoded.githubHandle)
        if (cancelled) return
        const recomputed = computeScore(gather.inputs, spec)
        setState({
          phase: 'done',
          verdict: scoreVerdict(decoded.score, recomputed),
          attestation: fetched.attestation,
          decoded,
          recomputed,
        })
      } catch {
        if (!cancelled) {
          setState({
            phase: 'invalid',
            problems: ['something went wrong while recomputing — try again'],
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'loading' && <p className="text-sm text-zinc-400">{state.step}</p>}

      {state.phase === 'invalid' && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
          <h1 className="text-sm font-medium text-red-400">Attestation could not be verified</h1>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-300">
            {state.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <Link href={verifyPath()} className="text-sm text-emerald-400 underline">
            ← Verify another attestation
          </Link>
        </div>
      )}

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          {state.verdict === 'match' && (
            <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4">
              <h1 className="text-sm font-medium text-emerald-400">
                ✓ Verified — recomputing today reproduces the attested score of{' '}
                {state.decoded.score}.
              </h1>
            </div>
          )}
          {state.verdict === 'diverged' && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
              <h1 className="text-sm font-medium text-amber-500">
                Attested {state.decoded.score}, recomputed {state.recomputed.total} today.
              </h1>
              <p className="text-xs text-zinc-400">
                Scores drift as public data changes. A divergence doesn’t mean the attestation was
                wrong when it was made — it means the data has moved since.
              </p>
            </div>
          )}
          {state.verdict === 'incomplete' && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
              <h1 className="text-sm font-medium text-amber-500">
                Comparison incomplete — some sources couldn’t be checked.
              </h1>
              <p className="text-xs text-zinc-400">
                Attested {state.decoded.score}; the partial recompute reached{' '}
                {state.recomputed.total}. Try again in a moment for a full comparison.
              </p>
            </div>
          )}

          <dl className="flex flex-col text-sm">
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Wallet</dt>
              <dd className="break-all text-right font-mono text-xs">
                <Link
                  href={scorePath(state.decoded.wallet, state.decoded.githubHandle)}
                  className="text-emerald-400 underline"
                >
                  {state.decoded.wallet}
                </Link>
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">GitHub handle</dt>
              <dd className="break-all text-right font-mono text-xs">
                {state.decoded.githubHandle ? `@${state.decoded.githubHandle}` : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Spec version</dt>
              <dd className="text-right font-mono text-xs">{state.decoded.specVersion}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Attested on</dt>
              <dd className="text-right font-mono text-xs">
                {new Date(state.attestation.timeCreated * 1000).toISOString()}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Attester</dt>
              <dd className="break-all text-right font-mono text-xs">
                {state.attestation.attester}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-zinc-500">Onchain record</dt>
              <dd className="text-right text-xs">
                <a
                  href={`${EASSCAN_SITE}/attestation/view/${state.attestation.uid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline"
                >
                  View on easscan
                </a>
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-400">Recomputed breakdown</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {state.recomputed.perCredential.map((result) => (
                <CredentialCard key={result.slug} result={result} />
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
```

Note: the UID path segment needs no `decodeURIComponent` — `isAttestationUid` only admits plain hex, so any percent-encoded junk simply fails validation into the invalid card.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exit 0. (If Next's dev-generated `.next/dev/types` are stale from a running dev server, run `npm run build` first and retry — known transient.)

Run: `npm test`
Expected: 98 tests pass.

Run: `npm run build`
Expected: exit 0; route list includes `○ /verify` and `ƒ /verify/[uid]`. Zero "Module not found" lines.

- [ ] **Step 5: Commit**

```bash
git add src/app/verify
git commit -m "feat: /verify and /verify/[uid] attestation verifier screens"
```

---

### Task 4: Entry links (footer + attest panel)

**Files:**
- Modify: `src/components/footer.tsx`
- Modify: `src/components/attest-panel.tsx`

**Interfaces:**
- Consumes: `verifyPath` from `@/lib/routes` (Task 2); the `/verify` screens (Task 3).

- [ ] **Step 1: Footer link**

In `src/components/footer.tsx`, add imports:

```tsx
import Link from 'next/link'
import { verifyPath } from '@/lib/routes'
```

and change the right-hand `<p>` to include a Verify link between the spec version and the EAS schema link:

```tsx
        <p>
          spec v{spec.version} ·{' '}
          <Link href={verifyPath()} className="underline">
            Verify
          </Link>{' '}
          ·{' '}
          <a href={SCHEMA_URL} target="_blank" rel="noreferrer" className="underline">
            EAS schema
          </a>
        </p>
```

- [ ] **Step 2: Attest panel success link**

In `src/components/attest-panel.tsx`, add imports:

```tsx
import Link from 'next/link'
import { verifyPath } from '@/lib/routes'
```

and replace the success block

```tsx
      {attestationUid && (
        <a
          href={`${EXPLORER_BASE}${attestationUid}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-emerald-400 underline break-all"
        >
          Attested — view {attestationUid} on easscan
        </a>
      )}
```

with

```tsx
      {attestationUid && (
        <div className="flex flex-col gap-1">
          <a
            href={`${EXPLORER_BASE}${attestationUid}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-emerald-400 underline break-all"
          >
            Attested — view {attestationUid} on easscan
          </a>
          <Link
            href={verifyPath(attestationUid)}
            className="text-xs text-emerald-400 underline"
          >
            Verify it here
          </Link>
        </div>
      )}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 98 tests. `npm run build` → exit 0, zero "Module not found".

- [ ] **Step 4: Commit**

```bash
git add src/components/footer.tsx src/components/attest-panel.tsx
git commit -m "feat: verifier entry links in footer and attest success"
```

---

## Post-plan validation (coordinator, not a task)

Browser pass: `/verify` form validates junk UIDs; `/verify/<real uid from the e2e attest>` (`0x8045e3d1e38085fddbec2c08ff8261bd7335f951b080aca6aeb9f3f4116ca743`) fetches, recomputes, and renders a verdict (match or diverged, depending on live data); footer link and a fake-UID invalid card work.
