# UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-page POC into a three-screen app — landing (`/`), input (`/score`), shareable results (`/score/[wallet]`) — with a header and footer, without touching scoring/fetching/attestation logic.

**Architecture:** URL-driven routes: the results screen recomputes from its URL on load, so score links are shareable and verify-by-recomputing. The landing page is a static server component with a small client CTA island. All heavy logic stays in the existing `src/lib` modules; the only lib changes are a new pure `routes.ts` helper and moving the `Scored` interface from `src/app/page.tsx` into `src/lib/orchestrate.ts`.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, RainbowKit 2 + wagmi 2, viem, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-ux-overhaul-design.md`

## Global Constraints

- Never add a `webpack:` key to `next.config.ts` (Next 16 hard-fails); the existing `turbopack.ignoreIssue` block must remain untouched.
- wagmi stays pinned to 2.x (RainbowKit peer dep). No new dependencies in this plan.
- Zero secrets, zero env vars, zero server-side state.
- `"use client"` pages cannot export `metadata`; the landing page must be a server component so it can.
- In Next 16, page `params`/`searchParams` props are **Promises**; client pages unwrap them with React's `use()`. If unsure, check `node_modules/next/dist/docs/` before writing code (per AGENTS.md).
- `useSearchParams()` (the hook) requires a `<Suspense>` boundary in statically prerendered pages — used only on `/score`, wrapped accordingly.
- All 70 existing tests must stay green. `src/lib` is untouched except: new `src/lib/routes.ts`, and adding `Scored` to `src/lib/orchestrate.ts`.
- `src/components/credential-card.tsx` must not change at all. `src/components/attest-panel.tsx` changes only its `Scored` import path (from `@/app/page` to `@/lib/orchestrate`) — no behavior change.
- The results/input URL shapes are defined **only** in `src/lib/routes.ts`; screens must use `scorePath`/`inputPath`, never hand-built strings.
- Visuals: keep the existing dark zinc + emerald aesthetic (`border-zinc-700/800`, `text-zinc-400/500/600`, `bg-emerald-600` buttons, `text-emerald-400` links).
- Work happens on branch `feat/ux-overhaul`.

---

### Task 1: Route helpers

**Files:**
- Create: `src/lib/routes.ts`
- Test: `test/routes.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces: `scorePath(wallet: string, github: string | null): string` (results URL) and `inputPath(wallet: string | null, github: string | null): string` (input URL with optional prefill params). Tasks 3 and 4 import both from `@/lib/routes`.

- [ ] **Step 1: Write the failing test**

Create `test/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scorePath, inputPath } from '@/lib/routes'

const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053'

describe('scorePath', () => {
  it('builds the results path without a handle', () => {
    expect(scorePath(WALLET, null)).toBe(`/score/${WALLET}`)
  })

  it('appends the github handle as a query param', () => {
    expect(scorePath(WALLET, 'octocat')).toBe(`/score/${WALLET}?github=octocat`)
  })

  it('treats empty and whitespace-only handles as absent', () => {
    expect(scorePath(WALLET, '')).toBe(`/score/${WALLET}`)
    expect(scorePath(WALLET, '   ')).toBe(`/score/${WALLET}`)
  })

  it('URL-encodes the handle', () => {
    expect(scorePath(WALLET, 'a b')).toBe(`/score/${WALLET}?github=a%20b`)
  })
})

describe('inputPath', () => {
  it('is bare /score with no prefill', () => {
    expect(inputPath(null, null)).toBe('/score')
  })

  it('carries wallet and github prefill params', () => {
    expect(inputPath(WALLET, 'octocat')).toBe(`/score?wallet=${WALLET}&github=octocat`)
  })

  it('omits empty values', () => {
    expect(inputPath(WALLET, '')).toBe(`/score?wallet=${WALLET}`)
    expect(inputPath('', 'octocat')).toBe('/score?github=octocat')
    expect(inputPath('  ', null)).toBe('/score')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes.test.ts`
Expected: FAIL — `Cannot find module '@/lib/routes'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/lib/routes.ts`:

```ts
// Route builders shared by the input and results screens, so the URL shape
// lives in exactly one place. Pure module: no imports, no framework.

export function scorePath(wallet: string, github: string | null): string {
  const base = `/score/${wallet}`
  const handle = github?.trim() ?? ''
  return handle ? `${base}?github=${encodeURIComponent(handle)}` : base
}

export function inputPath(wallet: string | null, github: string | null): string {
  const params = new URLSearchParams()
  const addr = wallet?.trim() ?? ''
  const handle = github?.trim() ?? ''
  if (addr) params.set('wallet', addr)
  if (handle) params.set('github', handle)
  const query = params.toString()
  return query ? `/score?${query}` : '/score'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes.test.ts`
Expected: PASS (7 tests).

Run: `npm test`
Expected: all files pass, 77 tests total (70 existing + 7 new).

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routes.ts test/routes.test.ts
git commit -m "feat: route helpers for score/input URLs"
```

---

### Task 2: Header, footer, layout wiring

**Files:**
- Create: `src/components/header.tsx`
- Create: `src/components/footer.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `ConnectButton` from `@rainbow-me/rainbowkit`; `ATTEST_SCHEMA_UID` from `@/lib/eas`; `Spec` type from `@/lib/types`; `spec/spec.json`.
- Produces: `<Header />` and `<Footer />` (no props), rendered by the root layout on every page. Later tasks rely on the header's ConnectButton existing globally.

- [ ] **Step 1: Create the header**

Create `src/components/header.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export function Header() {
  return (
    <header className="border-b border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Open Builder Score
        </Link>
        <ConnectButton showBalance={false} chainStatus="none" />
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Create the footer**

Create `src/components/footer.tsx`:

```tsx
import specJson from '../../spec/spec.json'
import { ATTEST_SCHEMA_UID } from '@/lib/eas'
import type { Spec } from '@/lib/types'

const spec = specJson as Spec

const SCHEMA_URL = `https://base-sepolia.easscan.org/schema/view/${ATTEST_SCHEMA_UID}`

export function Footer() {
  return (
    <footer className="border-t border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p>Computed entirely in your browser from public data. No backend.</p>
        <p>
          spec v{spec.version} ·{' '}
          <a href={SCHEMA_URL} target="_blank" rel="noreferrer" className="underline">
            EAS schema
          </a>
        </p>
      </div>
    </footer>
  )
}
```

- [ ] **Step 3: Wire both into the root layout**

Modify `src/app/layout.tsx` — add the two imports and wrap `{children}`. The full file after the change:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Builder Score",
  description:
    "A self-scoring page: enter a wallet and get an explainable Builder Score computed entirely in your browser from public data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
```

Note: `<Header />` must be inside `<Providers>` (it needs wagmi context for the ConnectButton). The layout itself stays a server component; the `'use client'` boundary is inside `header.tsx`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm test`
Expected: 77 tests pass, no changes.

Run: `npm run build`
Expected: exit 0, `✓ Compiled successfully`, routes `○ /` and `○ /_not-found` listed. Zero "Module not found" lines.

- [ ] **Step 5: Commit**

```bash
git add src/components/header.tsx src/components/footer.tsx src/app/layout.tsx
git commit -m "feat: global header and footer"
```

---

### Task 3: Results route `/score/[wallet]`

**Files:**
- Modify: `src/lib/orchestrate.ts` (add `Scored` interface)
- Modify: `src/components/attest-panel.tsx:9` (import path only)
- Modify: `src/app/page.tsx:14-19` (import `Scored` instead of defining it)
- Create: `src/app/score/[wallet]/page.tsx`

**Interfaces:**
- Consumes: `gatherInputs`, `GatherResult` from `@/lib/orchestrate`; `computeScore` from `@/lib/engine`; `scorePath`/`inputPath` from Task 1 (`inputPath` used for the edit link); `CredentialCard`, `AttestPanel` components.
- Produces: `Scored` interface exported from `@/lib/orchestrate` (`{ score: ScoreResult; gather: GatherResult; address: \`0x${string}\`; githubHandle: string | null }`) — consumed by `attest-panel.tsx` and (temporarily) the old `page.tsx`. The results page itself at `/score/<wallet>?github=<handle>`, which Task 4 navigates to.

- [ ] **Step 1: Move `Scored` into orchestrate.ts**

In `src/lib/orchestrate.ts`, change the types import (line 6) to include `ScoreResult`:

```ts
import type { CredentialInput, EngineInputs, ScoreResult, Spec } from './types'
```

and add directly below the existing `GatherResult` interface (after line 13):

```ts
// A fully computed score bundle as the UI screens pass it around.
export interface Scored {
  score: ScoreResult
  gather: GatherResult
  address: `0x${string}`
  githubHandle: string | null
}
```

- [ ] **Step 2: Point both existing consumers at the new location**

In `src/components/attest-panel.tsx`, replace line 9:

```ts
import type { Scored } from '@/app/page'
```

with:

```ts
import type { Scored } from '@/lib/orchestrate'
```

In `src/app/page.tsx`, delete the local interface (lines 14–19):

```ts
export interface Scored {
  score: ScoreResult
  gather: GatherResult
  address: `0x${string}`
  githubHandle: string | null
}
```

and instead import it: change line 7 from

```ts
import { gatherInputs, type GatherResult } from '@/lib/orchestrate'
```

to

```ts
import { gatherInputs, type Scored } from '@/lib/orchestrate'
```

Also remove the now-unused `ScoreResult` from the `@/lib/types` import on line 8 (keep `Spec`), since the interface that used it is gone:

```ts
import type { Spec } from '@/lib/types'
```

- [ ] **Step 3: Verify the move compiles before adding the new page**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Create the results page**

Create `src/app/score/[wallet]/page.tsx`:

```tsx
'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { isAddress } from 'viem'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type Scored } from '@/lib/orchestrate'
import type { Spec } from '@/lib/types'
import { inputPath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'
import { AttestPanel } from '@/components/attest-panel'

const spec = specJson as Spec

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; scored: Scored }

export default function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ wallet: string }>
  searchParams: Promise<{ github?: string }>
}) {
  const { wallet: rawWallet } = use(params)
  const { github } = use(searchParams)
  const wallet = decodeURIComponent(rawWallet)
  const githubHandle = github?.trim() || null

  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    if (!isAddress(wallet)) {
      setState({
        phase: 'error',
        message: 'That doesn’t look like an EVM address (0x…, 40 hex chars).',
      })
      return
    }
    const address = wallet // narrowed to `0x${string}` by isAddress above
    let cancelled = false
    setState({ phase: 'loading' })
    ;(async () => {
      try {
        const gather = await gatherInputs(address, githubHandle)
        if (cancelled) return
        setState({
          phase: 'done',
          scored: { score: computeScore(gather.inputs, spec), gather, address, githubHandle },
        })
      } catch {
        if (!cancelled) {
          setState({
            phase: 'error',
            message: 'Something went wrong while gathering data. Try again.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wallet, githubHandle])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'loading' && (
        <p className="text-sm text-zinc-400">
          Reading public data across 6 chains and GitHub…
        </p>
      )}

      {state.phase === 'error' && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
          <p className="text-sm text-red-400">{state.message}</p>
          <Link href="/score" className="text-sm text-emerald-400 underline">
            ← Back to the form
          </Link>
        </div>
      )}

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tabular-nums">{state.scored.score.total}</span>
              <span className="text-zinc-500">/ {state.scored.score.maxTotal}</span>
              {!state.scored.score.complete && (
                <span className="text-xs text-amber-500">
                  partial — some sources couldn&apos;t be checked
                </span>
              )}
            </div>
            <Link
              href={inputPath(state.scored.address, state.scored.githubHandle)}
              className="shrink-0 text-sm text-zinc-400 underline"
            >
              Edit inputs
            </Link>
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

Notes for the implementer:
- `params`/`searchParams` are Promises in Next 16; `use()` unwraps them in a client page. Verify the pattern in `node_modules/next/dist/docs/` if the types disagree.
- If TypeScript does not carry the `isAddress` narrowing of `wallet` into the async closure via `const address = wallet`, use `const address = wallet as \`0x${string}\`` with the same comment — the runtime guard is the line above.
- The score-display JSX is intentionally the old `page.tsx` display section plus the edit link and address line; the old page is replaced in Task 5.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm test`
Expected: 77 tests pass.

Run: `npm run build`
Expected: exit 0; route list now includes `ƒ /score/[wallet]` (dynamic) alongside `○ /`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/orchestrate.ts src/components/attest-panel.tsx src/app/page.tsx src/app/score
git commit -m "feat: shareable results route /score/[wallet]"
```

---

### Task 4: Input route `/score`

**Files:**
- Create: `src/app/score/page.tsx`

**Interfaces:**
- Consumes: `scorePath` from `@/lib/routes`; `useAccount` from `wagmi`; `isAddress` from `viem`; `useRouter`/`useSearchParams` from `next/navigation`.
- Produces: the `/score` screen that navigates to `scorePath(address, github)` on submit. Reads optional `?wallet=&github=` prefill params (produced by the results page's edit link and by nothing else).

- [ ] **Step 1: Create the input page**

Create `src/app/score/page.tsx`:

```tsx
'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { scorePath } from '@/lib/routes'

function ScoreForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address: connected } = useAccount()

  const [addressInput, setAddressInput] = useState(() => searchParams.get('wallet') ?? '')
  const [githubInput, setGithubInput] = useState(() => searchParams.get('github') ?? '')
  const [error, setError] = useState<string | null>(null)
  // Prefill from the connected wallet only while the user hasn't typed in the
  // field. A prefill from query params counts as touched.
  const touched = useRef(addressInput !== '')

  useEffect(() => {
    if (!touched.current && addressInput === '' && connected) {
      setAddressInput(connected)
    }
  }, [connected, addressInput])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const address = addressInput.trim()
    if (!isAddress(address)) {
      setError('That doesn’t look like an EVM address (0x…, 40 hex chars).')
      return
    }
    setError(null)
    router.push(scorePath(address, githubInput))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        value={addressInput}
        onChange={(e) => {
          touched.current = true
          setAddressInput(e.target.value)
        }}
        placeholder="Wallet address (0x…)"
        className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
        spellCheck={false}
      />
      <input
        value={githubInput}
        onChange={(e) => setGithubInput(e.target.value)}
        placeholder="GitHub handle (optional)"
        className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
        spellCheck={false}
      />
      <button
        type="submit"
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium"
      >
        Compute score
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  )
}

export default function ScorePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Check a Builder Score</h1>
        <p className="text-sm text-zinc-400">
          Enter any wallet. Scoring runs entirely in your browser — connecting a wallet is only
          needed to attest.
        </p>
      </header>
      <Suspense fallback={null}>
        <ScoreForm />
      </Suspense>
    </main>
  )
}
```

Notes for the implementer:
- The `Suspense` boundary around `ScoreForm` is required because `useSearchParams()` in a statically prerendered page bails to client rendering up to the nearest boundary; without it `next build` warns/errors.
- Submit does no computation — the results route does. There is deliberately no loading state here.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm test`
Expected: 77 tests pass.

Run: `npm run build`
Expected: exit 0; route list includes `○ /score` and `ƒ /score/[wallet]`. No `useSearchParams` prerender error.

- [ ] **Step 3: Commit**

```bash
git add src/app/score/page.tsx
git commit -m "feat: /score input screen with connected-wallet prefill"
```

---

### Task 5: Landing page + CTA island

**Files:**
- Create: `src/components/landing-cta.tsx`
- Modify: `src/app/page.tsx` (full replacement — becomes the landing, a server component)

**Interfaces:**
- Consumes: `useConnectModal` from `@rainbow-me/rainbowkit`, `useAccount` from `wagmi`, `useRouter` from `next/navigation` (CTA island); `spec/spec.json` + `Spec` type (landing copy).
- Produces: the final `/` landing page. Nothing downstream consumes it.

- [ ] **Step 1: Create the CTA island**

Create `src/components/landing-cta.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'

export function LandingCta() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { openConnectModal, connectModalOpen } = useConnectModal()
  // Route to /score only for a connection initiated from this button — never
  // auto-redirect a visitor who merely arrives connected or connects via the
  // header. Cleared if the modal is dismissed without connecting.
  const pending = useRef(false)
  const modalWasOpen = useRef(false)

  useEffect(() => {
    if (connectModalOpen) modalWasOpen.current = true
    if (pending.current && isConnected) {
      pending.current = false
      router.push('/score')
    } else if (pending.current && modalWasOpen.current && !connectModalOpen && !isConnected) {
      // Modal closed without a connection: cancel the pending redirect. If the
      // close event races ahead of the connect event, the user simply stays on
      // the landing page, already connected — clicking again proceeds.
      pending.current = false
    }
  }, [connectModalOpen, isConnected, router])

  function handleClick() {
    if (isConnected) {
      router.push('/score')
      return
    }
    pending.current = true
    openConnectModal?.()
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <button
        onClick={handleClick}
        className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium hover:bg-emerald-500"
      >
        Check your score
      </button>
      <Link href="/score" className="text-sm text-zinc-400 underline">
        or check any address
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Replace `src/app/page.tsx` with the landing**

Full new content of `src/app/page.tsx` (the old form/score display was superseded by Tasks 3–4; this file becomes a **server component** — no `'use client'`):

```tsx
import type { Metadata } from 'next'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import { LandingCta } from '@/components/landing-cta'

const spec = specJson as Spec

export const metadata: Metadata = {
  title: 'Open Builder Score — an explainable, attestable builder score',
  description:
    'Compute a Builder Score entirely in your browser from public onchain and GitHub data, see the exact math behind every point, and attest it on Base.',
}

const VALUE_PROPS = [
  {
    title: 'Computed in your browser',
    body: 'Public RPC and public APIs only. No backend, no accounts — nothing leaves your machine except the queries themselves.',
  },
  {
    title: 'Attested onchain',
    body: 'One click publishes an EAS attestation on Base that anyone can verify by recomputing the score.',
  },
  {
    title: 'Anyone can run it',
    body: `Open spec (v${spec.version}), open math. The same inputs always produce the same score.`,
  },
]

const STEPS = [
  'Enter any wallet address — and optionally a GitHub handle.',
  'Your browser queries public data across 6 chains and GitHub.',
  'Every point comes with the exact formula that produced it.',
  'Optionally attest the score on Base — verifiable by anyone.',
]

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 flex flex-col gap-16">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight">
          A builder score you don&apos;t have to trust.
        </h1>
        <p className="max-w-xl text-zinc-400">
          Open Builder Score computes an explainable Builder Score entirely in your browser from
          public data — then lets you attest it onchain.
        </p>
        <LandingCta />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map((prop) => (
          <div key={prop.title} className="rounded-lg border border-zinc-800 p-4">
            <h2 className="text-sm font-medium">{prop.title}</h2>
            <p className="mt-2 text-xs text-zinc-400">{prop.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-baseline gap-3 text-sm text-zinc-300">
              <span className="font-mono text-xs text-emerald-500">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
```

Note: this page exports `metadata` — that is only legal because it is a server component. Do not add `'use client'` here; the interactive part lives in `landing-cta.tsx`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0 (the old page's imports are gone with the file's replacement; nothing else imported from `@/app/page` after Task 3).

Run: `npm test`
Expected: 77 tests pass.

Run: `npm run build`
Expected: exit 0; route list shows `○ /` (static), `○ /score`, `ƒ /score/[wallet]`.

Confirm with `grep -r "from '@/app/page'" src/` → no matches.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/landing-cta.tsx
git commit -m "feat: landing page with connect-wallet CTA"
```

---

## Post-plan validation (coordinator, not a task)

Manual browser pass on `npm run dev`: landing renders with chrome; CTA secondary link reaches `/score`; connected wallet prefills the form; submit navigates to `/score/0x…` and recomputes; edit link round-trips values; invalid address URL shows the error card; attest panel unchanged on results.
