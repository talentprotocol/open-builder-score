# Credentials Reference Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, shareable `/credentials` page listing the 20 active credentials with their exact scoring math, grouped by scan source, with per-credential deep links — derived from the same `spec.json` the engine scores with.

**Architecture:** A pure helper (`src/lib/credential-reference.ts`) turns `spec.json` into grouped display data with engine-notation formulas; a static server page renders it with existing motion/brand primitives (FadeRise, PingDot, Badge); three links (footer, landing card, results page) point at it via a new `credentialsPath` route builder.

**Tech Stack:** Next.js 16.2.11 App Router (custom build — consult `node_modules/next/dist/docs/` for Next-specific behavior per AGENTS.md), Tailwind v4 tokens from `globals.css`, vitest (node env), Motion via existing shared components only.

**Spec:** `docs/superpowers/specs/2026-07-28-credentials-reference-design.md`

## Global Constraints

- All work on branch `feat/credentials-reference`. Commit at the end of every task.
- **No changes to existing motion components or their behavior.** The new page only composes `FadeRise`, `PingDot`, `Badge` as-is.
- **Brand rules (from the Talent branding merge):** monochrome tokens only; emerald only as signal — on this page that is exactly the settled PingDots and the `target:ring-success/60` deep-link ring. Semantic TEXT would use `-text` token forms, but this page plans none. `Button`/`Badge` have no tailwind-merge: pass only additive `className` values.
- **No engine/spec/scoring changes.** `spec/spec.json`, `src/lib/engine.ts`, and everything else in `src/lib` outside the new helper stay untouched.
- Gates for every task: `npm run typecheck && npm run test && npm run build` pass. Test baseline is 163 and only grows. `npx eslint <changed files>` reports zero NEW problems (repo has pre-existing errors in untouched files).
- Engine formula notation (from `src/lib/engine.ts:38-49,93`): `min(round(<converted> × <multiplier>), <max_score>)` where converted renders as `sqrt(x)` / `ln(x)` / `<x>y` (timestamp_to_year) / bare value. The reference's general forms use `value` / `sqrt(value)` / `ln(value)` / `years` in those slots.

---

### Task 1: Credential-reference helper (TDD)

**Files:**
- Create: `src/lib/credential-reference.ts`
- Test: `test/credential-reference.test.ts`

**Interfaces:**
- Consumes: `Spec`, `SpecCredential`, `Conversion` from `src/lib/types.ts`; `computeScore` from `src/lib/engine.ts` (test only).
- Produces (Task 2 relies on these exact names/shapes):
  - `interface CredentialGroup { key: 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'; label: string; credentials: SpecCredential[]; maxTotal: number }`
  - `groupCredentials(spec: Spec): CredentialGroup[]` — 4 groups, scan order
  - `formatFormula(c: SpecCredential): string`
  - `describeValue(c: SpecCredential): string`
  - `describeCalculation(c: SpecCredential): string`
  - `displayNote(c: SpecCredential): string | null`

- [ ] **Step 1: Write the failing tests** — create `test/credential-reference.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import specJson from '../spec/spec.json'
import { computeScore } from '@/lib/engine'
import {
  describeCalculation,
  describeValue,
  displayNote,
  formatFormula,
  groupCredentials,
} from '@/lib/credential-reference'
import type { Conversion, Spec, SpecCredential } from '@/lib/types'

const spec = specJson as Spec

function cred(over: Partial<SpecCredential>): SpecCredential {
  return {
    slug: 'fixture',
    name: 'Fixture',
    tier: 'rpc',
    value: 'nft_count',
    max_score: 10,
    multiplier: 2,
    conversion: 'no_conversion',
    calculation: 'max_value',
    poc: true,
    ...over,
  }
}

describe('groupCredentials', () => {
  it('returns the four scan sources in scan order', () => {
    const groups = groupCredentials(spec)
    expect(groups.map((g) => g.key)).toEqual(['chains', 'github', 'speedrun', 'verifiedBuilder'])
    expect(groups.map((g) => g.label)).toEqual([
      'Onchain badges & balances',
      'GitHub',
      'SpeedRun Ethereum',
      'EAS attestations',
    ])
  })

  it('covers exactly the active credentials, no dupes, none missing', () => {
    const grouped = groupCredentials(spec).flatMap((g) => g.credentials.map((c) => c.slug))
    const active = spec.credentials.filter((c) => c.poc).map((c) => c.slug)
    expect(grouped.length).toBe(active.length)
    expect(new Set(grouped)).toEqual(new Set(active))
  })

  it('group max totals sum to the engine maxTotal', () => {
    const groups = groupCredentials(spec)
    const summed = groups.reduce((n, g) => n + g.maxTotal, 0)
    const engine = computeScore({ computedAt: 0, values: {} }, spec)
    expect(summed).toBe(engine.maxTotal)
  })

  it('every group maxTotal is the sum of its credentials', () => {
    for (const g of groupCredentials(spec)) {
      expect(g.maxTotal).toBe(g.credentials.reduce((n, c) => n + c.max_score, 0))
    }
  })
})

describe('formatFormula', () => {
  it('renders each conversion in engine notation', () => {
    expect(formatFormula(cred({ conversion: 'no_conversion', multiplier: 2, max_score: 10 }))).toBe(
      'min(round(value × 2), 10)',
    )
    expect(formatFormula(cred({ conversion: 'sqrt', multiplier: 10, max_score: 20 }))).toBe(
      'min(round(sqrt(value) × 10), 20)',
    )
    expect(formatFormula(cred({ conversion: 'log', multiplier: 2, max_score: 10 }))).toBe(
      'min(round(ln(value) × 2), 10)',
    )
    expect(formatFormula(cred({ conversion: 'timestamp_to_year', multiplier: 1, max_score: 8 }))).toBe(
      'min(round(years × 1), 8)',
    )
  })

  it('throws on an unknown conversion', () => {
    expect(() => formatFormula(cred({ conversion: 'cubed' as Conversion }))).toThrow(/conversion/)
  })
})

describe('describeValue', () => {
  it('describes every value kind used by active credentials', () => {
    for (const c of spec.credentials.filter((c) => c.poc)) {
      expect(describeValue(c)).toBeTruthy()
    }
  })

  it('throws on an unknown value kind', () => {
    expect(() => describeValue(cred({ value: 'mystery_metric' }))).toThrow(/mystery_metric/)
  })
})

describe('describeCalculation', () => {
  it('labels both aggregation modes', () => {
    expect(describeCalculation(cred({ calculation: 'sum_all' }))).toBe('summed across wallets')
    expect(describeCalculation(cred({ calculation: 'max_value' }))).toBe('best wallet counts')
  })
})

describe('displayNote', () => {
  it('curates only the two user-relevant notes', () => {
    const noted = spec.credentials.filter((c) => c.poc && displayNote(c) !== null).map((c) => c.slug)
    expect(new Set(noted)).toEqual(new Set(['github_repositories', 'base_learn']))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/credential-reference.test.ts`
Expected: FAIL — cannot resolve `@/lib/credential-reference`.

- [ ] **Step 3: Write the implementation** — create `src/lib/credential-reference.ts`:

```ts
// Display-layer derivation of the credential reference from spec.json — the
// same file the engine scores with, so the reference can never drift.
// Pure module: no framework, no fetches. Unknown enum values throw so a bad
// spec edit fails the build and tests instead of shipping a wrong page.

import type { Spec, SpecCredential } from './types'

export interface CredentialGroup {
  key: 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'
  label: string
  credentials: SpecCredential[]
  maxTotal: number
}

const SPEEDRUN_SLUG = 'buidl_guidl_speedrun_ethereum'
const EAS_SLUG = 'talent_protocol_verified_builder'

// Group order and vocabulary mirror the scan checklist (SOURCE_LABELS on the
// results page), so the reference reads as the annotated version of the scan.
export function groupCredentials(spec: Spec): CredentialGroup[] {
  const active = spec.credentials.filter((c) => c.poc)
  const groups: Omit<CredentialGroup, 'maxTotal'>[] = [
    {
      key: 'chains',
      label: 'Onchain badges & balances',
      credentials: active.filter(
        (c) => c.tier !== 'github_public' && c.slug !== SPEEDRUN_SLUG && c.slug !== EAS_SLUG,
      ),
    },
    { key: 'github', label: 'GitHub', credentials: active.filter((c) => c.tier === 'github_public') },
    {
      key: 'speedrun',
      label: 'SpeedRun Ethereum',
      credentials: active.filter((c) => c.slug === SPEEDRUN_SLUG),
    },
    {
      key: 'verifiedBuilder',
      label: 'EAS attestations',
      credentials: active.filter((c) => c.slug === EAS_SLUG),
    },
  ]
  return groups.map((g) => ({
    ...g,
    maxTotal: g.credentials.reduce((sum, c) => sum + c.max_score, 0),
  }))
}

// General form of the engine's instantiated formula (engine.ts renders
// `min(round(sqrt(9) × 0.03), 8) = 1`; the reference abstracts the value).
export function formatFormula(c: SpecCredential): string {
  return `min(round(${generalConverted(c.conversion)} × ${c.multiplier}), ${c.max_score})`
}

function generalConverted(conversion: string): string {
  switch (conversion) {
    case 'no_conversion':
      return 'value'
    case 'sqrt':
      return 'sqrt(value)'
    case 'log':
      return 'ln(value)'
    case 'timestamp_to_year':
      return 'years'
    default:
      throw new Error(`no general form for conversion: ${conversion}`)
  }
}

const VALUE_DESCRIPTIONS: Record<string, string> = {
  nft_count: 'badges held',
  distinct_contracts_owned: 'distinct qualifying contracts held',
  erc20_balance_whole_tokens: 'token balance (whole tokens)',
  contract_call: 'vault balance',
  distinct_attesters: 'distinct attesters',
  created_at_unix_timestamp: 'account creation date',
  followers_count: 'followers',
  sum_stargazers_over_owned_repos: 'stars across owned repos',
  sum_forks_over_owned_repos: 'forks across owned repos',
  public_repo_count: 'public repositories',
  accepted_challenge_count: 'accepted challenges',
}

export function describeValue(c: SpecCredential): string {
  const description = VALUE_DESCRIPTIONS[c.value]
  if (!description) throw new Error(`no description for value kind: ${c.value}`)
  return description
}

// Multi-wallet aggregation, in the user's terms.
export function describeCalculation(c: SpecCredential): string {
  return c.calculation === 'sum_all' ? 'summed across wallets' : 'best wallet counts'
}

// Curated user-facing notes. Raw spec notes are dev-facing and stay out of
// the UI; only these two change what a reader should expect from a score.
const DISPLAY_NOTES: Record<string, string> = {
  github_repositories: 'Approximates production: public repo count vs. repos contributed-to.',
  base_learn: 'Badges live on Base Sepolia (testnet).',
}

export function displayNote(c: SpecCredential): string | null {
  return DISPLAY_NOTES[c.slug] ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/credential-reference.test.ts`
Expected: PASS (all). Then `npm run test` — 163 + new all green. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/credential-reference.ts test/credential-reference.test.ts
git commit -m "feat: credential-reference helper derives display data from spec.json"
```

---

### Task 2: Route builder + /credentials page

**Files:**
- Modify: `src/lib/routes.ts` (append)
- Modify: `test/routes.test.ts` (append)
- Create: `src/app/credentials/page.tsx`

**Interfaces:**
- Consumes: everything Task 1 produces; `Badge` (`@/components/ui/badge`, props `variant?/compact?/className?`); `PingDot` (`@/components/motion/ping-dot`, `{ settled: boolean }`); `FadeRise` (`@/components/motion/fade-rise`, `{ delay?, whileInView?, className? }`).
- Produces: `credentialsPath(slug?: string | null): string` — Task 3 relies on it.

- [ ] **Step 1: Write the failing route tests** — append to `test/routes.test.ts`:

```ts
describe('credentialsPath', () => {
  it('returns the bare page path', () => {
    expect(credentialsPath()).toBe('/credentials')
  })

  it('appends a slug anchor for deep links', () => {
    expect(credentialsPath('github_forks')).toBe('/credentials#github_forks')
  })
})
```

and add `credentialsPath` to the file's existing `@/lib/routes` import.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/routes.test.ts`
Expected: FAIL — `credentialsPath` is not exported.

- [ ] **Step 3: Implement the route builder** — append to `src/lib/routes.ts`:

```ts
export function credentialsPath(slug: string | null = null): string {
  return slug ? `/credentials#${slug}` : '/credentials'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/app/credentials/page.tsx`** exactly:

```tsx
import type { Metadata } from 'next'
import specJson from '../../../spec/spec.json'
import type { Spec } from '@/lib/types'
import {
  describeCalculation,
  describeValue,
  displayNote,
  formatFormula,
  groupCredentials,
} from '@/lib/credential-reference'
import { Badge } from '@/components/ui/badge'
import { PingDot } from '@/components/motion/ping-dot'
import { FadeRise } from '@/components/motion/fade-rise'

const spec = specJson as Spec
const groups = groupCredentials(spec)
const credentialCount = groups.reduce((n, g) => n + g.credentials.length, 0)
const maxTotal = groups.reduce((n, g) => n + g.maxTotal, 0)

export const metadata: Metadata = {
  title: 'Builder Score credentials — Open Builder Score',
  description: `Every credential in the open Builder Score: what it measures, the exact formula, and the points it can earn — ${maxTotal} max.`,
}

export default function CredentialsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-10">
      <FadeRise className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-normal">Credentials</h1>
        <p className="text-base text-muted-foreground">
          Every point in a Builder Score comes from one of these {credentialCount} credentials —{' '}
          <span className="font-mono tabular-nums">{maxTotal}</span> max points. Same inputs, same
          score, for anyone.
        </p>
      </FadeRise>

      {groups.map((group) => (
        <FadeRise whileInView key={group.key}>
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <PingDot settled /> {group.label}
              </h2>
              <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground/70">
                {group.maxTotal} PTS
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {group.credentials.map((c) => (
                <article
                  key={c.slug}
                  id={c.slug}
                  className="flex scroll-mt-16 flex-col gap-1 rounded-lg border bg-card p-4 shadow-xs target:ring-1 target:ring-success/60 dark:bg-card/50"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-base font-medium">{c.name}</h3>
                    <span className="shrink-0 font-mono text-base tabular-nums tracking-tighter">
                      {c.max_score} pts
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Measures: {describeValue(c)}</p>
                  <p className="font-mono text-sm text-muted-foreground/80">{formatFormula(c)}</p>
                  <Badge compact className="mt-1">
                    {describeCalculation(c)}
                  </Badge>
                  {displayNote(c) && (
                    <p className="text-sm text-muted-foreground/80">{displayNote(c)}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        </FadeRise>
      ))}
    </main>
  )
}
```

Notes for the implementer: this is a server component composing client components (PingDot/FadeRise/Badge) — valid RSC pattern, no `'use client'` here. The `target:` variant is Tailwind's `:target` pseudo-class variant (built into v4). `spec.json` import path has THREE `../` segments from `src/app/credentials/`.

- [ ] **Step 6: Gates + static check**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass; build output lists `/credentials` as ○ (Static). Also `npx eslint src/app/credentials/page.tsx src/lib/routes.ts test/routes.test.ts` — zero problems.

- [ ] **Step 7: Commit**

```bash
git add src/lib/routes.ts test/routes.test.ts src/app/credentials
git commit -m "feat: /credentials reference page with per-credential anchors"
```

---

### Task 3: Entry links (footer, landing, results)

**Files:**
- Modify: `src/components/footer.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/score/[wallet]/page.tsx`

**Interfaces:**
- Consumes: `credentialsPath` from `@/lib/routes` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Footer link** — in `src/components/footer.tsx`: add `credentialsPath` to the existing `@/lib/routes` import, then insert BEFORE the Verify `<Link>` (same idiom):

```tsx
<Link
  href={credentialsPath()}
  className="text-base opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
>
  Credentials
</Link>
```

- [ ] **Step 2: Landing card link** — in `src/app/page.tsx`:
  - add imports: `import Link from 'next/link'` and `import { credentialsPath } from '@/lib/routes'`
  - retype the array and add the link to the third entry:

```ts
const VALUE_PROPS: { title: string; body: string; link?: { href: string; label: string } }[] = [
  {
    title: 'Computed in your browser',
    body: 'Public RPC and public APIs only — no accounts, and nothing leaves your machine except the queries themselves.',
  },
  {
    title: 'Attested onchain',
    body: 'One click publishes an EAS attestation on Base that anyone can verify by recomputing the score.',
  },
  {
    title: 'Anyone can run it',
    body: 'Open spec, open math. The same inputs always produce the same score.',
    link: { href: credentialsPath(), label: 'See every credential →' },
  },
]
```

  - in the card render, after the body `<p>`, add:

```tsx
{prop.link && (
  <p className="mt-2 text-sm">
    <Link
      href={prop.link.href}
      className="text-muted-foreground underline transition-colors hover:text-foreground"
    >
      {prop.link.label}
    </Link>
  </p>
)}
```

- [ ] **Step 3: Results-page link** — in `src/app/score/[wallet]/page.tsx`: add `credentialsPath` to the existing `@/lib/routes` import; directly after the closing `</Stagger>` tag (before the computed-at footnote `FadeRise delay={0.15}`), insert:

```tsx
<FadeRise delay={0.12}>
  <p>
    <Link
      href={credentialsPath()}
      className="text-sm text-muted-foreground underline transition-colors hover:text-foreground"
    >
      Full credential reference →
    </Link>
  </p>
</FadeRise>
```

(`Link` and `FadeRise` are already imported in this file.)

- [ ] **Step 4: Gates**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. `npx eslint src/components/footer.tsx src/app/page.tsx "src/app/score/[wallet]/page.tsx"` — zero NEW problems (the results page has one pre-existing set-state-in-effect error on an untouched line).

- [ ] **Step 5: Commit**

```bash
git add src/components/footer.tsx src/app/page.tsx "src/app/score/[wallet]/page.tsx"
git commit -m "feat: link the credentials reference from footer, landing, and results"
```

---

## Verification (controller)

Browser pass after Task 3: `/credentials` in dark + light (group captions, card grid, PingDots, Badge chips); deep link `/credentials#github_forks` scrolls to and signal-rings the card; all three entry links navigate; reduced motion unaffected (page uses existing guarded primitives only).

## Self-review notes

- Spec coverage: §1 helper → Task 1; §2 page/anchors/target-ring → Task 2; §3 routes+links → Tasks 2–3; §4 tests → Tasks 1–2; §5 fail-fast throws → Task 1; §6 out-of-scope respected (no other files touched).
- Type consistency: `credentialsPath(slug?: string | null)` matches across Tasks 2–3; helper export names identical in Task 1 code, Task 1 tests, and Task 2 page imports.
- `describeCalculation` returns `string` (not `string | null` as an early spec draft said) — both labels are always shown; the spec's §1 signature is the authority-in-intent, this plan is the authority-in-letter.
