# Results & Input Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ENS-name input everywhere a wallet goes, a per-source loading checklist, retry, copy-link, and an attestation-history section on results.

**Architecture:** Two new framework-free libs (`ens.ts`, `history.ts`) with injectable I/O and unit tests; one additive callback on `gatherInputs`; the `/score` form and `/score/[wallet]` results page updated in place; two small client components (`copy-link-button.tsx`, `attestation-history.tsx`).

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, viem (`getEnsAddress`, `normalize`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-results-input-polish-design.md`

## Global Constraints

- Never add a `webpack:` key to `next.config.ts`; leave its `turbopack.ignoreIssue` block untouched.
- No new dependencies. Zero secrets, zero env vars. Public RPC endpoints only.
- URL shapes only via `scorePath`/`inputPath`/`verifyPath` from `@/lib/routes` — never hand-built internal URLs.
- `src/lib/engine.ts`, `chains.ts` (except one added export), `github.ts`, `easscan.ts`, `speedrun.ts`, `eas.ts`, `verify.ts` unchanged. `orchestrate.ts` changes only additively (optional 4th param + exported `GatherSource` type). `credential-card.tsx`, `attest-panel.tsx` unchanged.
- All 103 existing tests stay green; this plan adds tests in `test/ens.test.ts`, `test/history.test.ts`, `test/orchestrate.test.ts`.
- Visuals: dark zinc + emerald aesthetic; amber for partial states.
- If `npm run typecheck` fails inside `.next/dev/types` (stale dev-server-generated types), run `npm run build` first and retry — known transient.
- Work happens on branch `feat/polish-2`.

---

### Task 1: ENS lib

**Files:**
- Modify: `src/lib/chains.ts` (one added export, directly below the `CHAIN_CONFIG` declaration)
- Create: `src/lib/ens.ts`
- Test: `test/ens.test.ts`

**Interfaces:**
- Consumes: viem `createPublicClient`, `fallback`, `http`; `viem/chains` `mainnet`; `viem/ens` `normalize`.
- Produces: `looksLikeEnsName(value: string): boolean`; `resolveEnsName(name: string, resolver?: EnsResolverFn): Promise<EnsResolution>` with `EnsResolution = {status:'resolved'; address: \`0x${string}\`} | {status:'unresolved'} | {status:'error'; reason: string}` and `EnsResolverFn = (name: string) => Promise<\`0x${string}\` | null>`; `MAINNET_RPC_URLS: string[]` from `chains.ts`. Tasks 4–5 import the first two from `@/lib/ens`.

- [ ] **Step 1: Add the RPC list export**

In `src/lib/chains.ts`, directly after the `CHAIN_CONFIG` object closes, add:

```ts
// Reused by src/lib/ens.ts for mainnet ENS resolution.
export const MAINNET_RPC_URLS = CHAIN_CONFIG[1].rpcUrls
```

- [ ] **Step 2: Write the failing tests**

Create `test/ens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { looksLikeEnsName, resolveEnsName, type EnsResolverFn } from '@/lib/ens'

const ADDRESS = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const

describe('looksLikeEnsName', () => {
  it('accepts dotted names', () => {
    expect(looksLikeEnsName('vitalik.eth')).toBe(true)
    expect(looksLikeEnsName('sub.name.eth')).toBe(true)
  })
  it('rejects addresses, dotless strings, whitespace, and too-short values', () => {
    expect(looksLikeEnsName(ADDRESS)).toBe(false)
    expect(looksLikeEnsName('nodot')).toBe(false)
    expect(looksLikeEnsName('a b.eth')).toBe(false)
    expect(looksLikeEnsName('.e')).toBe(false)
  })
})

describe('resolveEnsName', () => {
  it('resolves via the injected resolver with a normalized name', async () => {
    let seen: string | null = null
    const resolver: EnsResolverFn = async (name) => {
      seen = name
      return ADDRESS
    }
    const result = await resolveEnsName('  Vitalik.eth ', resolver)
    expect(result).toEqual({ status: 'resolved', address: ADDRESS })
    expect(seen).toBe('vitalik.eth')
  })
  it('maps a null resolution to unresolved', async () => {
    const resolver: EnsResolverFn = async () => null
    expect(await resolveEnsName('nobody.eth', resolver)).toEqual({ status: 'unresolved' })
  })
  it('maps resolver failures to error', async () => {
    const resolver: EnsResolverFn = async () => {
      throw new Error('boom')
    }
    const result = await resolveEnsName('vitalik.eth', resolver)
    expect(result.status).toBe('error')
  })
  it('maps un-normalizable names to error without calling the resolver', async () => {
    let called = false
    const resolver: EnsResolverFn = async () => {
      called = true
      return null
    }
    const result = await resolveEnsName('ab..eth', resolver)
    expect(result.status).toBe('error')
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/ens.test.ts`
Expected: FAIL — cannot resolve `@/lib/ens`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/ens.ts`:

```ts
import { createPublicClient, fallback, http } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { MAINNET_RPC_URLS } from './chains'

export type EnsResolution =
  | { status: 'resolved'; address: `0x${string}` }
  | { status: 'unresolved' }
  | { status: 'error'; reason: string }

export type EnsResolverFn = (name: string) => Promise<`0x${string}` | null>

export function looksLikeEnsName(value: string): boolean {
  const v = value.trim()
  return v.length > 2 && v.includes('.') && !/\s/.test(v)
}

let cachedResolver: EnsResolverFn | null = null

function defaultResolver(): EnsResolverFn {
  const client = createPublicClient({
    chain: mainnet,
    transport: fallback(MAINNET_RPC_URLS.map((url) => http(url))),
  })
  return (name) => client.getEnsAddress({ name })
}

export async function resolveEnsName(
  name: string,
  resolver?: EnsResolverFn,
): Promise<EnsResolution> {
  let normalized: string
  try {
    normalized = normalize(name.trim())
  } catch {
    return { status: 'error', reason: 'That isn’t a valid ENS name.' }
  }
  const resolve = resolver ?? (cachedResolver ??= defaultResolver())
  try {
    const address = await resolve(normalized)
    return address ? { status: 'resolved', address } : { status: 'unresolved' }
  } catch {
    return { status: 'error', reason: 'ENS lookup failed — try again.' }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/ens.test.ts` → PASS (6 tests).
Run: `npm test` → 109 tests pass. `npm run typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chains.ts src/lib/ens.ts test/ens.test.ts
git commit -m "feat: ENS resolution lib with injectable resolver"
```

---

### Task 2: `gatherInputs` settlement callback

**Files:**
- Modify: `src/lib/orchestrate.ts`
- Test: `test/orchestrate.test.ts` (append one test)

**Interfaces:**
- Produces: exported `type GatherSource = 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'`; `gatherInputs(address, githubHandle, fetchers = {}, onSourceSettled?: (source: GatherSource) => void)` — 4th param optional, existing callers unaffected. Task 5 consumes both.

- [ ] **Step 1: Write the failing test**

Append to `test/orchestrate.test.ts` (inside the existing top-level describe, reusing that file's existing stub-fetcher style — read the file first and mirror how its other tests build `fetchers`):

```ts
it('reports each source as it settles', async () => {
  const settled: string[] = []
  const ok = { status: 'ok' as const, accounts: [0] }
  await gatherInputs(
    '0x0000000000000000000000000000000000000001',
    null,
    {
      chains: async () => ({ values: {}, baseBlockNumber: null }),
      github: async () => ({}),
      speedrun: async () => ok,
      verifiedBuilder: async () => ok,
    },
    (source) => settled.push(source),
  )
  expect([...settled].sort()).toEqual(['chains', 'github', 'speedrun', 'verifiedBuilder'])
})
```

(Adjust the import line to include `type GatherSource` only if the file's lint/typecheck needs it; the test itself uses plain strings.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/orchestrate.test.ts`
Expected: FAIL — `gatherInputs` accepts 3 arguments (TypeScript error) or the callback is never invoked.

- [ ] **Step 3: Implement**

In `src/lib/orchestrate.ts`, add the exported type above `gatherInputs`:

```ts
export type GatherSource = 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'
```

and change `gatherInputs`'s signature and the `Promise.all` block:

```ts
export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
  onSourceSettled?: (source: GatherSource) => void,
): Promise<GatherResult> {
  const f = { ...defaultFetchers, ...fetchers }
  const computedAt = Math.floor(Date.now() / 1000)
  const pocRpcSlugs = new Set(
    spec.credentials.filter((c) => c.poc && c.tier === 'rpc').map((c) => c.slug),
  )

  const settle = <T,>(source: GatherSource, promise: Promise<T>): Promise<T> =>
    promise.finally(() => onSourceSettled?.(source))

  const [chainResult, github, speedrun, verifiedBuilder] = await Promise.all([
    settle('chains', f.chains(address, pocRpcSlugs)),
    settle('github', f.github(githubHandle)),
    settle('speedrun', f.speedrun(address)),
    settle('verifiedBuilder', f.verifiedBuilder(address)),
  ])
```

(The return statement is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/orchestrate.test.ts` → PASS.
Run: `npm test` → 110 tests pass. `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrate.ts test/orchestrate.test.ts
git commit -m "feat: gatherInputs reports per-source settlement"
```

---

### Task 3: History lib

**Files:**
- Create: `src/lib/history.ts`
- Test: `test/history.test.ts`

**Interfaces:**
- Consumes: `EASSCAN_GRAPHQL`, `decodeAttestationData` from `./verify`; `ATTEST_SCHEMA_UID` from `./eas`; viem `getAddress`.
- Produces (Task 6 imports from `@/lib/history`): `fetchScoreAttestationHistory(wallet: string, fetchFn?: typeof fetch): Promise<HistoryResult>`; `HistoryResult = {status:'ok'; attestations: ScoreAttestationSummary[]} | {status:'error'}`; `ScoreAttestationSummary = {uid: string; score: number; specVersion: string; timeCreated: number; revoked: boolean}`; also exported for tests: `HISTORY_QUERY`, `parseHistoryResponse`.

- [ ] **Step 1: Write the failing tests**

Create `test/history.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters } from 'viem'
import {
  fetchScoreAttestationHistory,
  HISTORY_QUERY,
  parseHistoryResponse,
} from '@/lib/history'
import { ATTEST_SCHEMA_UID } from '@/lib/eas'
import specJson from '../spec/spec.json'
import type { Spec } from '@/lib/types'

const spec = specJson as Spec
const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const UID = `0x${'cd'.repeat(32)}`

function encodeData(score: number, specVersion: string = spec.version): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'address' },
      { type: 'string' },
      { type: 'uint16' },
      { type: 'uint64' },
      { type: 'uint64' },
    ],
    [specVersion, WALLET, '', score, 1784975866n, 49093260n],
  )
}

function entry(overrides: Record<string, unknown> = {}) {
  return { id: UID, revocationTime: 0, timeCreated: 1784975900, data: encodeData(103), ...overrides }
}

describe('parseHistoryResponse', () => {
  it('decodes attestation summaries', () => {
    const result = parseHistoryResponse({ data: { attestations: [entry()] } })
    expect(result).toEqual({
      status: 'ok',
      attestations: [
        { uid: UID, score: 103, specVersion: spec.version, timeCreated: 1784975900, revoked: false },
      ],
    })
  })
  it('marks revoked entries', () => {
    const result = parseHistoryResponse({
      data: { attestations: [entry({ revocationTime: 1784976000 })] },
    })
    expect(result.status === 'ok' && result.attestations[0].revoked).toBe(true)
  })
  it('skips undecodable entries but keeps good ones', () => {
    const result = parseHistoryResponse({
      data: { attestations: [entry({ data: '0x1234' }), entry()] },
    })
    expect(result.status === 'ok' && result.attestations).toHaveLength(1)
  })
  it('maps junk shapes to error', () => {
    expect(parseHistoryResponse(null).status).toBe('error')
    expect(parseHistoryResponse({ data: {} }).status).toBe('error')
  })
})

describe('fetchScoreAttestationHistory', () => {
  it('posts recipient + schema and parses the list', async () => {
    let body = ''
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ data: { attestations: [entry()] } }), { status: 200 })
    }) as typeof fetch
    const result = await fetchScoreAttestationHistory(WALLET.toLowerCase(), fakeFetch)
    expect(result.status).toBe('ok')
    expect(body).toContain(WALLET) // checksummed recipient
    expect(body).toContain(ATTEST_SCHEMA_UID)
    expect(body).toContain(HISTORY_QUERY.slice(0, 20))
  })
  it('maps HTTP and network failures to error', async () => {
    const httpFail = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect((await fetchScoreAttestationHistory(WALLET, httpFail)).status).toBe('error')
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await fetchScoreAttestationHistory(WALLET, netFail)).status).toBe('error')
  })
  it('rejects invalid wallets without fetching', async () => {
    let called = false
    const fakeFetch = (async () => {
      called = true
      return new Response('{}')
    }) as typeof fetch
    expect((await fetchScoreAttestationHistory('nope', fakeFetch)).status).toBe('error')
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/history.test.ts`
Expected: FAIL — cannot resolve `@/lib/history`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/history.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/history.test.ts` → PASS (7 tests).
Run: `npm test` → 117 tests pass. `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/history.ts test/history.test.ts
git commit -m "feat: attestation history lib"
```

---

### Task 4: ENS in the form + landing copy

**Files:**
- Modify: `src/app/score/page.tsx`
- Modify: `src/app/page.tsx` (two copy tweaks)

**Interfaces:**
- Consumes: `looksLikeEnsName`, `resolveEnsName` from `@/lib/ens` (Task 1); `scorePath` from `@/lib/routes`.

- [ ] **Step 1: Update the form**

In `src/app/score/page.tsx`:

Add to the imports:

```tsx
import { looksLikeEnsName, resolveEnsName } from '@/lib/ens'
```

Add a `resolving` state below the `error` state:

```tsx
  const [resolving, setResolving] = useState(false)
```

Replace `handleSubmit` with:

```tsx
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const input = addressInput.trim()
    if (isAddress(input)) {
      setError(null)
      router.push(scorePath(input, githubInput))
      return
    }
    if (looksLikeEnsName(input)) {
      setError(null)
      setResolving(true)
      const resolution = await resolveEnsName(input)
      setResolving(false)
      if (resolution.status === 'resolved') {
        router.push(scorePath(resolution.address, githubInput))
      } else if (resolution.status === 'unresolved') {
        setError(`“${input}” doesn’t resolve to an address.`)
      } else {
        setError(resolution.reason)
      }
      return
    }
    setError('Enter an EVM address (0x…, 40 hex chars) or an ENS name.')
  }
```

Update the wallet field's label text to `Wallet address or ENS name`, its placeholder to `0x… or name.eth`, and the submit button to:

```tsx
      <button
        type="submit"
        disabled={resolving}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {resolving ? 'Resolving name…' : 'Compute score'}
      </button>
```

Also update the page header paragraph's first sentence from `Enter any wallet.` to `Enter any wallet or ENS name.`

- [ ] **Step 2: Landing copy**

In `src/app/page.tsx`, change `STEPS[0]` from
`'Enter any wallet address — and optionally a GitHub handle.'` to
`'Enter any wallet address or ENS name — and optionally a GitHub handle.'`

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 117 tests. `npm run build` → exit 0, zero "Module not found".

- [ ] **Step 4: Commit**

```bash
git add src/app/score/page.tsx src/app/page.tsx
git commit -m "feat: ENS names accepted in the score form"
```

---

### Task 5: Results page rework (ENS redirect, loading checklist, retry, copy link)

**Files:**
- Create: `src/components/copy-link-button.tsx`
- Modify: `src/app/score/[wallet]/page.tsx` (full replacement below)

**Interfaces:**
- Consumes: `GatherSource` + 4-arg `gatherInputs` (Task 2); `looksLikeEnsName`/`resolveEnsName` (Task 1); existing `scorePath`/`inputPath`.
- Produces: results page still renders `<AttestPanel scored={…} />` last in the done section — Task 6 appends its component right after it.

- [ ] **Step 1: Create the copy-link button**

Create `src/components/copy-link-button.tsx`:

```tsx
'use client'

import { useState } from 'react'

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (permissions/insecure context): quietly do nothing.
    }
  }

  return (
    <button onClick={handleCopy} className="text-sm text-zinc-400 underline">
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}
```

- [ ] **Step 2: Replace the results page**

Full new content of `src/app/score/[wallet]/page.tsx`:

```tsx
'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAddress } from 'viem'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type GatherSource, type Scored } from '@/lib/orchestrate'
import { looksLikeEnsName, resolveEnsName } from '@/lib/ens'
import type { Spec } from '@/lib/types'
import { inputPath, scorePath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'
import { AttestPanel } from '@/components/attest-panel'
import { CopyLinkButton } from '@/components/copy-link-button'

const spec = specJson as Spec

const SOURCE_LABELS: Record<GatherSource, string> = {
  chains: 'Onchain badges & balances (6 chains)',
  github: 'GitHub',
  speedrun: 'SpeedRun Ethereum',
  verifiedBuilder: 'EAS attestations',
}

const SOURCES = Object.keys(SOURCE_LABELS) as GatherSource[]

type State =
  | { phase: 'resolving' }
  | { phase: 'loading'; settled: GatherSource[] }
  | { phase: 'error'; message: string }
  | { phase: 'done'; scored: Scored }

export default function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ wallet: string }>
  searchParams: Promise<{ github?: string }>
}) {
  const router = useRouter()
  const { wallet: rawWallet } = use(params)
  const { github } = use(searchParams)
  let wallet: string
  try {
    wallet = decodeURIComponent(rawWallet)
  } catch {
    // Malformed percent-encoding: fall through with the raw segment, which
    // fails isAddress and surfaces the normal error state.
    wallet = rawWallet
  }
  const githubHandle = github?.trim() || null

  const [state, setState] = useState<State>({ phase: 'loading', settled: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    if (!isAddress(wallet)) {
      if (looksLikeEnsName(wallet)) {
        // Shareable links like /score/vitalik.eth: resolve, then canonicalize.
        setState({ phase: 'resolving' })
        ;(async () => {
          const resolution = await resolveEnsName(wallet)
          if (cancelled) return
          if (resolution.status === 'resolved') {
            router.replace(scorePath(resolution.address, githubHandle))
          } else if (resolution.status === 'unresolved') {
            setState({ phase: 'error', message: `“${wallet}” doesn’t resolve to an address.` })
          } else {
            setState({ phase: 'error', message: resolution.reason })
          }
        })()
      } else {
        setState({
          phase: 'error',
          message: 'That doesn’t look like an EVM address (0x…, 40 hex chars) or ENS name.',
        })
      }
      return () => {
        cancelled = true
      }
    }

    const address = wallet // narrowed to `0x${string}` by isAddress above
    setState({ phase: 'loading', settled: [] })
    ;(async () => {
      try {
        const gather = await gatherInputs(address, githubHandle, {}, (source) => {
          if (cancelled) return
          setState((prev) =>
            prev.phase === 'loading'
              ? { phase: 'loading', settled: [...prev.settled, source] }
              : prev,
          )
        })
        if (cancelled) return
        setState({
          phase: 'done',
          scored: { score: computeScore(gather.inputs, spec), gather, address, githubHandle },
        })
      } catch {
        if (!cancelled) {
          setState({ phase: 'error', message: 'Something went wrong while gathering data.' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wallet, githubHandle, attempt, router])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'resolving' && (
        <p className="text-sm text-zinc-400">Resolving ENS name…</p>
      )}

      {state.phase === 'loading' && (
        <ul className="flex flex-col gap-2 text-sm">
          {SOURCES.map((source) => {
            const done = state.settled.includes(source)
            return (
              <li key={source} className={done ? 'text-emerald-400' : 'text-zinc-500'}>
                {done ? '✓' : '○'} {SOURCE_LABELS[source]}
              </li>
            )
          })}
        </ul>
      )}

      {state.phase === 'error' && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
          <p className="text-sm text-red-400">{state.message}</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setAttempt((a) => a + 1)}
              className="text-sm text-emerald-400 underline"
            >
              Try again
            </button>
            <Link href={inputPath()} className="text-sm text-zinc-400 underline">
              ← Back to the form
            </Link>
          </div>
        </div>
      )}

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tabular-nums">{state.scored.score.total}</span>
              <span className="text-zinc-500">/ {state.scored.score.maxTotal}</span>
              {!state.scored.score.complete && (
                <span className="flex items-center gap-2 text-xs text-amber-500">
                  partial — some sources couldn&apos;t be checked
                  <button onClick={() => setAttempt((a) => a + 1)} className="underline">
                    try again
                  </button>
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <CopyLinkButton />
              <Link
                href={inputPath(state.scored.address, state.scored.githubHandle)}
                className="text-sm text-zinc-400 underline"
              >
                Edit inputs
              </Link>
            </div>
          </div>

          <p className="break-all font-mono text-xs text-zinc-500">
            {state.scored.address}
            {state.scored.githubHandle && ` · @${state.scored.githubHandle}`}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {state.scored.score.perCredential.map((result) => (
              <CredentialCard key={result.slug} result={result} />
            ))}
          </div>

          <p className="text-xs text-zinc-600">
            github_repositories approximates production (public repo count vs. repos
            contributed-to). Computed at{' '}
            {new Date(state.scored.gather.inputs.computedAt * 1000).toISOString()}
            {state.scored.gather.baseBlockNumber !== null &&
              `, Base block ${state.scored.gather.baseBlockNumber}`}
            .
          </p>

          <AttestPanel scored={state.scored} />
        </section>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 117 tests. `npm run build` → exit 0, zero "Module not found".

- [ ] **Step 4: Commit**

```bash
git add src/components/copy-link-button.tsx 'src/app/score/[wallet]/page.tsx'
git commit -m "feat: ENS redirect, per-source loading, retry, copy link on results"
```

---

### Task 6: Attestation history section

**Files:**
- Create: `src/components/attestation-history.tsx`
- Modify: `src/app/score/[wallet]/page.tsx` (one import + one JSX line)

**Interfaces:**
- Consumes: `fetchScoreAttestationHistory`, `ScoreAttestationSummary` from `@/lib/history` (Task 3); `verifyPath` from `@/lib/routes`.

- [ ] **Step 1: Create the component**

Create `src/components/attestation-history.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchScoreAttestationHistory, type ScoreAttestationSummary } from '@/lib/history'
import { verifyPath } from '@/lib/routes'

// Supplemental section: renders nothing while loading, on error, or when empty.
export function AttestationHistory({ wallet }: { wallet: `0x${string}` }) {
  const [attestations, setAttestations] = useState<ScoreAttestationSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchScoreAttestationHistory(wallet)
      if (!cancelled && result.status === 'ok') setAttestations(result.attestations)
    })()
    return () => {
      cancelled = true
    }
  }, [wallet])

  if (!attestations || attestations.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-400">Attestation history</h2>
      <ul className="flex flex-col text-sm">
        {attestations.map((a) => (
          <li
            key={a.uid}
            className="flex items-center justify-between gap-4 border-b border-zinc-800 py-1.5 last:border-b-0"
          >
            <span className={a.revoked ? 'text-zinc-600 line-through' : 'text-zinc-300'}>
              {a.score} pts · spec v{a.specVersion} ·{' '}
              {new Date(a.timeCreated * 1000).toISOString().slice(0, 10)}
              {a.revoked && ' · revoked'}
            </span>
            <Link href={verifyPath(a.uid)} className="shrink-0 text-xs text-emerald-400 underline">
              Verify →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the results page**

In `src/app/score/[wallet]/page.tsx`, add the import:

```tsx
import { AttestationHistory } from '@/components/attestation-history'
```

and directly after `<AttestPanel scored={state.scored} />` add:

```tsx
          <AttestationHistory wallet={state.scored.address} />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 117 tests. `npm run build` → exit 0, zero "Module not found".

- [ ] **Step 4: Commit**

```bash
git add src/components/attestation-history.tsx 'src/app/score/[wallet]/page.tsx'
git commit -m "feat: attestation history on results"
```

---

## Post-plan validation (coordinator, not a task)

Browser pass: `/score` accepts `vitalik.eth` (resolves, navigates); `/score/vitalik.eth` canonicalizes to the address URL; loading shows the 4-item checklist ticking; results show Copy link + history section (for the e2e-attested wallet, the 103-score attestation appears with a Verify link); partial retry button appears only on partial results.
