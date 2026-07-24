# Open Builder Score POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page Next.js app where anyone enters a wallet (+ optional GitHub handle) and gets an explainable, attestable Builder Score computed entirely in the browser from public data.

**Architecture:** A pure, framework-free scoring engine (`src/lib/engine.ts`) consumes already-fetched raw values plus `spec/spec.json`. Thin fetcher modules gather those values: one Multicall3 round-trip per chain (viem), the GitHub public REST API, the SpeedRun Ethereum public API, and the easscan GraphQL indexers. A fully client-side page orchestrates fetch → compute → render per-credential cards, with an optional EAS attestation on Base signed and paid by the user via RainbowKit.

**Tech Stack:** Next.js 16.2.11 (App Router, Turbopack, everything `"use client"`), TypeScript strict, Tailwind v4, viem 2.x, wagmi 2.19.5 + RainbowKit 2.2.11 + TanStack Query 5, `@ethereum-attestation-service/eas-sdk` 2.9.1 (+ ethers v6 for its signer adapter), Vitest 4.

## Global Constraints

- Node.js >= 20.9 required (Next 16 floor). Machine has v22.9.0 — engine warnings from transitive deps are non-blocking noise.
- **NEVER add a `webpack:` key to next.config.ts** — Next 16 builds with Turbopack by default and **hard-fails the build if any webpack config is present**. If "Module not found" warnings appear for optional deps (pino-pretty, lokijs, encoding), use `turbopack.resolveAlias` with a browser condition or `turbopack.ignoreIssue` instead.
- **wagmi stays pinned to 2.x** (RainbowKit 2.2.11 peer dep). Never `npm install wagmi@latest` (that's 3.x and breaks peers).
- Do not add `--turbopack` flags to package.json scripts (it's the default). There is no `next lint`; lint is `npx eslint .` (flat config, already scaffolded).
- Zero secrets, zero env vars, zero server-side state. No API routes, no server actions, no `.env` files. The WalletConnect projectId is a public client identifier and is hardcoded on purpose.
- A `"use client"` page cannot export `metadata` — metadata lives in the (server) root layout only.
- The client page is still prerendered at build time: no `window`/`localStorage` access at module scope. wagmi config uses `ssr: true`.
- **The engine is framework-free**: `src/lib/engine.ts` and `src/lib/types.ts` must import nothing from React, Next, viem, wagmi, or use `fetch`. Weights, formulas, addresses come ONLY from `spec/spec.json` / `spec/badge-registry.json` (imported as JSON modules) — never duplicate a weight or address in source code.
- Scoring math (production-exact): `points = clamp(round(convert(value) × multiplier), 0, max_score)`; `sum_all` sums raw values BEFORE converting; `max_value` converts per account and takes the best; `log` is natural log; `timestamp_to_year = round2((computedAt − value) / 31_536_000)`; total = Σ points.
- Path alias `@/*` → `./src/*` is configured in tsconfig and vitest config; use it in app code and tests.
- TDD throughout: write the failing test first, watch it fail, implement, watch it pass, commit. Test commands: `npm test` (all) or `npx vitest run test/<file>.test.ts`.
- Next 16 has breaking changes vs training data — when unsure about a Next API, read `node_modules/next/dist/docs/` (see repo AGENTS.md).
- Commit after every task with a conventional message (`feat:`, `test:`, `chore:`).

## File Structure

```
vitest.config.ts             Vitest config (node env, test/ include, @ alias)
src/lib/types.ts             Spec/registry/engine types (framework-free)
src/lib/engine.ts            computeScore — pure math (framework-free)
src/lib/chains.ts            chain plan builder + Multicall3 executor + anchors
src/lib/github.ts            5 GitHub metrics, unauthenticated
src/lib/speedrun.ts          SpeedRun Ethereum accepted-challenge count
src/lib/easscan.ts           Verified Builder distinct-attester count (Base+Celo)
src/lib/orchestrate.ts       gatherInputs — parallel fetch + merge
src/lib/wallet.ts            WalletConnect projectId constant
src/lib/eas.ts               EAS constants, schema UID helper, attest()
src/app/providers.tsx        Wagmi + RainbowKit + React Query providers
src/app/layout.tsx           (modify) metadata + Providers wrapper
src/app/page.tsx             (replace) the self-scoring page, "use client"
src/components/credential-card.tsx
src/components/attest-panel.tsx
test/spec-consistency.test.ts
test/engine.test.ts
test/chains.test.ts
test/github.test.ts
test/speedrun.test.ts
test/easscan.test.ts
test/orchestrate.test.ts
test/eas.test.ts
```

---

### Task 1: Test harness, shared types, spec-consistency tests

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` + `typecheck` scripts)
- Create: `src/lib/types.ts`
- Test: `test/spec-consistency.test.ts`

**Interfaces:**
- Consumes: `spec/spec.json`, `spec/badge-registry.json` (existing).
- Produces (every later task relies on these exact types):

```ts
// src/lib/types.ts — no imports from React/Next/viem/wagmi allowed here
export type Conversion = 'no_conversion' | 'sqrt' | 'log' | 'timestamp_to_year'
export type Calculation = 'sum_all' | 'max_value'

export interface SpecCredential {
  slug: string
  name: string
  tier: string
  value: string
  max_score: number
  multiplier: number
  conversion: Conversion
  calculation: Calculation
  poc: boolean
  notes?: string
}

export interface Spec {
  name: string
  version: string
  constants: { SECONDS_IN_A_YEAR: number }
  credentials: SpecCredential[]
}

export interface RegistryContract { name: string; chain: string; address: string }
export interface RegistryCredential {
  method: string
  contracts?: RegistryContract[] | string
  call?: { function: string; result_index: number; divide_by: string }
  schema_uid?: string
  networks?: string[]
}
export interface Registry {
  version: string
  chains: Record<string, number>
  credentials: Record<string, RegistryCredential>
}

export type CredentialInput =
  | { status: 'ok'; accounts: number[] }        // one raw value per account (POC: single wallet)
  | { status: 'unavailable'; reason: string }

export interface EngineInputs {
  computedAt: number                            // unix seconds — the single "now"
  values: Record<string, CredentialInput>       // keyed by credential slug
}

export type CredentialState = 'earned' | 'not_earned' | 'unavailable'

export interface CredentialResult {
  slug: string
  name: string
  points: number
  maxScore: number
  rawValue: number | null      // sum_all: summed raw; max_value: the best account's raw
  converted: number | null
  formula: string              // e.g. "min(round(sqrt(900) × 0.03), 8) = 1", or "—"
  state: CredentialState
  unavailableReason?: string
}

export interface ScoreResult {
  total: number
  maxTotal: number
  perCredential: CredentialResult[]
  complete: boolean            // false if ANY credential is 'unavailable' — gates attestation
}
```

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` object add (keep existing entries):

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: Write the failing consistency test**

`test/spec-consistency.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import specJson from '../spec/spec.json'
import registryJson from '../spec/badge-registry.json'
import type { Spec, Registry } from '@/lib/types'

const spec = specJson as Spec
const registry = registryJson as unknown as Registry

const pocSlugs = spec.credentials.filter((c) => c.poc).map((c) => c.slug)

describe('spec.json', () => {
  it('has 22 POC credentials', () => {
    expect(pocSlugs).toHaveLength(22)
  })

  it('uses only known conversions and calculations', () => {
    for (const c of spec.credentials) {
      expect(['no_conversion', 'sqrt', 'log', 'timestamp_to_year']).toContain(c.conversion)
      expect(['sum_all', 'max_value']).toContain(c.calculation)
      expect(c.max_score).toBeGreaterThan(0)
      expect(c.multiplier).toBeGreaterThan(0)
    }
  })

  it('pins SECONDS_IN_A_YEAR to the production constant', () => {
    expect(spec.constants.SECONDS_IN_A_YEAR).toBe(31_536_000)
  })
})

describe('badge-registry.json', () => {
  const rpcPocSlugs = spec.credentials
    .filter((c) => c.poc && c.tier === 'rpc')
    .map((c) => c.slug)

  it('covers every POC rpc credential with a contracts array', () => {
    for (const slug of rpcPocSlugs) {
      const entry = registry.credentials[slug]
      expect(entry, `missing registry entry for ${slug}`).toBeDefined()
      expect(Array.isArray(entry.contracts), `${slug} needs a contracts array`).toBe(true)
    }
  })

  it('has valid addresses and known chains on every contract', () => {
    for (const [slug, entry] of Object.entries(registry.credentials)) {
      if (!Array.isArray(entry.contracts)) continue
      for (const contract of entry.contracts) {
        expect(contract.address, `${slug}/${contract.name}`).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(registry.chains[contract.chain], `${slug} unknown chain ${contract.chain}`).toBeDefined()
      }
    }
  })

  it('has the talent_vault call config', () => {
    const vault = registry.credentials.talent_vault
    expect(vault.call).toEqual({
      function: 'userBalanceMeta(address)',
      result_index: 0,
      divide_by: '1e18',
    })
  })

  it('has the verified_builder schema uid on base+celo', () => {
    const vb = registry.credentials.talent_protocol_verified_builder
    expect(vb.schema_uid).toBe('0x597905068aedcde4321ceaf2c42e24d3bbe0af694159bececd686bf057ec7ea5')
    expect(vb.networks).toEqual(['base-mainnet', 'celo-mainnet'])
  })
})
```

- [ ] **Step 4: Run — expect failure (types module missing)**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/types`.

- [ ] **Step 5: Create `src/lib/types.ts`** with the exact content from the Interfaces block above.

- [ ] **Step 6: Run — expect pass**

Run: `npm test`
Expected: all spec-consistency tests PASS. (If the 22-count assertion fails, count `"poc": true` entries in spec.json and fix the TEST, not the spec.)

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add vitest.config.ts package.json package-lock.json src/lib/types.ts test/spec-consistency.test.ts
git commit -m "test: vitest harness, shared types, spec consistency checks"
```

---

### Task 2: The scoring engine

**Files:**
- Create: `src/lib/engine.ts`
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `Spec`, `EngineInputs`, `CredentialInput` from `@/lib/types` (Task 1).
- Produces (used by Task 8 orchestration and Task 10 UI):
  - `computeScore(inputs: EngineInputs, spec: Spec): ScoreResult`
  - `convert(conversion: Conversion, value: number, computedAt: number, secondsInAYear: number): number`
  - `round2(x: number): number`

- [ ] **Step 1: Write the failing tests**

`test/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import specJson from '../spec/spec.json'
import type { Spec, EngineInputs, CredentialInput } from '@/lib/types'
import { computeScore, convert, round2 } from '@/lib/engine'

const spec = specJson as Spec
const YEAR = 31_536_000
const NOW = 1_753_401_600

const ok = (...accounts: number[]): CredentialInput => ({ status: 'ok', accounts })

// Every POC slug present; hand-computed expected points in comments.
const goldenValues: Record<string, CredentialInput> = {
  eth_global_hacker: ok(2),                    // min(round(2×12), 12)  = 12
  eth_global_builder: ok(),                    // no accounts           = 0 (not_earned)
  eth_global_pioneer: ok(0),                   // 0×10                  = 0 (not_earned)
  eth_global_partner: ok(),                    //                       = 0
  eth_global_finalist: ok(1),                  // min(10, 10)           = 10
  devfolio_hackathons_participation: ok(9),    // sqrt(9)=3 ×10=30→20   = 20
  base_devfolio_hackathons_participation: ok(1), // sqrt(1)×10          = 10
  base_basecamp: ok(1),                        // 1×20                  = 20
  base_learn: ok(7),                           // 7×1                   = 7
  buidl_guidl_speedrun_ethereum: ok(4),        // 4×1                   = 4
  buidl_guidl_batches_graduate: ok(1),         // 1×20                  = 20
  farcaster_farcon_nyc_2025_attendee: ok(1),   // 1×12                  = 12
  crypto_nomads_club: ok(0),                   //                       = 0
  developer_dao_member: ok(150),               // 150×0.02              = 3
  talent_protocol_talent_holder: ok(900),      // sqrt(900)=30 ×0.03=0.9→round = 1
  talent_vault: ok(0),                         //                       = 0
  talent_protocol_verified_builder: ok(2),     // 2×20=40→20            = 20
  github_account_age: ok(NOW - 165_564_000),   // 5.25y ×1 → round      = 5
  github_followers: ok(170),                   // sqrt(170)≈13.04→13→6  = 6
  github_stars: ok(64),                        // sqrt(64)=8 ×0.5       = 4
  github_forks: ok(49),                        // sqrt(49)=7 ×2=14→12   = 12
  github_repositories: ok(16),                 // sqrt(16)=4 ×2=8       = 8
}

describe('convert', () => {
  it('no_conversion is identity', () => expect(convert('no_conversion', 7, NOW, YEAR)).toBe(7))
  it('sqrt', () => expect(convert('sqrt', 9, NOW, YEAR)).toBe(3))
  it('sqrt clamps negatives to 0', () => expect(convert('sqrt', -4, NOW, YEAR)).toBe(0))
  it('log is natural log', () => expect(convert('log', Math.E, NOW, YEAR)).toBeCloseTo(1))
  it('log clamps values <= 1 to 0', () => {
    expect(convert('log', 0, NOW, YEAR)).toBe(0)
    expect(convert('log', 1, NOW, YEAR)).toBe(0)
  })
  it('timestamp_to_year rounds to 2 decimals', () =>
    expect(convert('timestamp_to_year', NOW - 165_564_000, NOW, YEAR)).toBe(5.25))
  it('timestamp_to_year clamps future timestamps to 0', () =>
    expect(convert('timestamp_to_year', NOW + YEAR, NOW, YEAR)).toBe(0))
})

describe('computeScore — golden vector', () => {
  const result = computeScore({ computedAt: NOW, values: goldenValues }, spec)

  it('total is 174', () => expect(result.total).toBe(174))
  it('maxTotal is 277', () => expect(result.maxTotal).toBe(277))
  it('is complete', () => expect(result.complete).toBe(true))
  it('covers all 22 POC credentials', () => expect(result.perCredential).toHaveLength(22))

  const points = Object.fromEntries(result.perCredential.map((r) => [r.slug, r.points]))
  it.each([
    ['eth_global_hacker', 12], ['eth_global_finalist', 10],
    ['devfolio_hackathons_participation', 20], ['base_learn', 7],
    ['talent_protocol_talent_holder', 1], ['talent_protocol_verified_builder', 20],
    ['github_account_age', 5], ['github_followers', 6], ['github_forks', 12],
  ])('%s = %i points', (slug, expected) => expect(points[slug]).toBe(expected))

  it('zero raw value is not_earned with 0 points', () => {
    const pioneer = result.perCredential.find((r) => r.slug === 'eth_global_pioneer')!
    expect(pioneer.points).toBe(0)
    expect(pioneer.state).toBe('not_earned')
  })

  it('empty accounts is not_earned with null raw', () => {
    const builder = result.perCredential.find((r) => r.slug === 'eth_global_builder')!
    expect(builder.state).toBe('not_earned')
    expect(builder.rawValue).toBeNull()
    expect(builder.formula).toBe('—')
  })

  it('renders an explainable formula string', () => {
    const talent = result.perCredential.find((r) => r.slug === 'talent_protocol_talent_holder')!
    expect(talent.formula).toBe('min(round(sqrt(900) × 0.03), 8) = 1')
  })
})

describe('computeScore — calculation modes', () => {
  it('sum_all sums raw values BEFORE converting', () => {
    // github_forks: sqrt, ×2, max 12. Correct: sqrt(16+9)=5 → 10.
    // Wrong (convert-then-sum): sqrt(16)+sqrt(9)=7 → 14 → clamped 12.
    const r = computeScore(
      { computedAt: NOW, values: { ...goldenValues, github_forks: ok(16, 9) } },
      spec,
    )
    expect(r.perCredential.find((c) => c.slug === 'github_forks')!.points).toBe(10)
  })

  it('max_value converts per account and takes the best', () => {
    // devfolio: sqrt ×10 max 20. Accounts 1 → 10, 4 → 20. Best = 20.
    const r = computeScore(
      { computedAt: NOW, values: { ...goldenValues, devfolio_hackathons_participation: ok(1, 4) } },
      spec,
    )
    const c = r.perCredential.find((x) => x.slug === 'devfolio_hackathons_participation')!
    expect(c.points).toBe(20)
    expect(c.rawValue).toBe(4)
  })
})

describe('computeScore — unavailable propagation', () => {
  const values = {
    ...goldenValues,
    crypto_nomads_club: { status: 'unavailable', reason: 'RPC failed' } as CredentialInput,
  }
  const result = computeScore({ computedAt: NOW, values }, spec)

  it('keeps the total of the remaining credentials', () => expect(result.total).toBe(174))
  it('marks the result incomplete', () => expect(result.complete).toBe(false))
  it('carries the reason', () => {
    const cnc = result.perCredential.find((r) => r.slug === 'crypto_nomads_club')!
    expect(cnc.state).toBe('unavailable')
    expect(cnc.points).toBe(0)
    expect(cnc.unavailableReason).toBe('RPC failed')
  })

  it('treats a missing slug as unavailable', () => {
    const { eth_global_hacker: _omitted, ...rest } = goldenValues
    const r = computeScore({ computedAt: NOW, values: rest }, spec)
    expect(r.complete).toBe(false)
    expect(r.perCredential.find((c) => c.slug === 'eth_global_hacker')!.state).toBe('unavailable')
  })
})

describe('round2', () => {
  it('rounds to 2 decimals', () => expect(round2(5.249999)).toBe(5.25))
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run test/engine.test.ts`
Expected: FAIL — `@/lib/engine` not found.

- [ ] **Step 3: Implement `src/lib/engine.ts`**

```ts
import type {
  Calculation,
  Conversion,
  CredentialInput,
  CredentialResult,
  EngineInputs,
  ScoreResult,
  Spec,
  SpecCredential,
} from './types'

export function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export function convert(
  conversion: Conversion,
  value: number,
  computedAt: number,
  secondsInAYear: number,
): number {
  switch (conversion) {
    case 'no_conversion':
      return value
    case 'sqrt':
      return value <= 0 ? 0 : Math.sqrt(value)
    case 'log':
      return value <= 1 ? 0 : Math.log(value)
    case 'timestamp_to_year':
      return Math.max(0, round2((computedAt - value) / secondsInAYear))
  }
}

function clampPoints(candidate: number, maxScore: number): number {
  return Math.max(0, Math.min(Math.round(candidate), maxScore))
}

function formatConverted(conversion: Conversion, rawValue: number, converted: number): string {
  switch (conversion) {
    case 'sqrt':
      return `sqrt(${rawValue})`
    case 'log':
      return `ln(${rawValue})`
    case 'timestamp_to_year':
      return `${converted}y`
    case 'no_conversion':
      return `${rawValue}`
  }
}

function scoreCredential(
  c: SpecCredential,
  input: CredentialInput,
  computedAt: number,
  secondsInAYear: number,
): CredentialResult {
  const base = { slug: c.slug, name: c.name, maxScore: c.max_score }

  if (input.status === 'unavailable') {
    return {
      ...base,
      points: 0,
      rawValue: null,
      converted: null,
      formula: '—',
      state: 'unavailable',
      unavailableReason: input.reason,
    }
  }

  if (input.accounts.length === 0) {
    return { ...base, points: 0, rawValue: null, converted: null, formula: '—', state: 'not_earned' }
  }

  let rawValue: number
  let converted: number
  if (c.calculation === ('sum_all' satisfies Calculation)) {
    rawValue = input.accounts.reduce((a, b) => a + b, 0)
    converted = convert(c.conversion, rawValue, computedAt, secondsInAYear)
  } else {
    // max_value: convert × multiply per account, take the best account
    let best = { raw: input.accounts[0], converted: 0, candidate: -Infinity }
    for (const raw of input.accounts) {
      const conv = convert(c.conversion, raw, computedAt, secondsInAYear)
      const candidate = conv * c.multiplier
      if (candidate > best.candidate) best = { raw, converted: conv, candidate }
    }
    rawValue = best.raw
    converted = best.converted
  }

  const points = clampPoints(converted * c.multiplier, c.max_score)
  const formula = `min(round(${formatConverted(c.conversion, rawValue, converted)} × ${c.multiplier}), ${c.max_score}) = ${points}`
  return {
    ...base,
    points,
    rawValue,
    converted,
    formula,
    state: points > 0 ? 'earned' : 'not_earned',
  }
}

export function computeScore(inputs: EngineInputs, spec: Spec): ScoreResult {
  const pocCredentials = spec.credentials.filter((c) => c.poc)
  const perCredential = pocCredentials.map((c) =>
    scoreCredential(
      c,
      inputs.values[c.slug] ?? { status: 'unavailable', reason: 'not fetched' },
      inputs.computedAt,
      spec.constants.SECONDS_IN_A_YEAR,
    ),
  )
  return {
    total: perCredential.reduce((sum, r) => sum + r.points, 0),
    maxTotal: pocCredentials.reduce((sum, c) => sum + c.max_score, 0),
    perCredential,
    complete: perCredential.every((r) => r.state !== 'unavailable'),
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run test/engine.test.ts`
Expected: PASS, all tests green. If the golden total differs, recompute by hand per the comments in the test before touching the engine — the expected values were hand-derived from spec.json.

- [ ] **Step 5: Verify the engine stays framework-free**

Run: `grep -nE "from 'react|from 'next|from 'viem|from 'wagmi|fetch\(" src/lib/engine.ts src/lib/types.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine.ts test/engine.test.ts
git commit -m "feat: pure scoring engine with golden test vectors"
```

---

### Task 3: Chain reads — plan builder, aggregator, Multicall3 executor

**Files:**
- Create: `src/lib/chains.ts`
- Test: `test/chains.test.ts`

**Interfaces:**
- Consumes: `Registry`, `Spec`, `CredentialInput` types (Task 1); `spec/badge-registry.json`, `spec/spec.json`.
- Produces (used by Task 8):
  - `buildChainPlan(registry: Registry, pocRpcSlugs: Set<string>): ChainPlan[]`
  - `aggregateChainResults(plan: ChainPlan, outcomes: ReadOutcome[]): Record<string, CredentialInput>`
  - `readChainCredentials(address: \`0x${string}\`, pocRpcSlugs: Set<string>): Promise<ChainReadResult>` where `ChainReadResult = { values: Record<string, CredentialInput>; baseBlockNumber: bigint | null }`
  - Exported types: `ChainPlan = { chainId: number; reads: PlannedRead[] }`, `PlannedRead = { slug: string; method: string; address: \`0x${string}\` }`, `ReadOutcome = { success: boolean; value: bigint | readonly bigint[] | null }`

- [ ] **Step 1: Write the failing tests** (pure parts only — no network in tests)

`test/chains.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import specJson from '../spec/spec.json'
import registryJson from '../spec/badge-registry.json'
import type { Registry, Spec } from '@/lib/types'
import { buildChainPlan, aggregateChainResults, type ChainPlan, type ReadOutcome } from '@/lib/chains'

const spec = specJson as Spec
const registry = registryJson as unknown as Registry
const pocRpcSlugs = new Set(
  spec.credentials.filter((c) => c.poc && c.tier === 'rpc').map((c) => c.slug),
)

describe('buildChainPlan', () => {
  const plan = buildChainPlan(registry, pocRpcSlugs)
  const byChain = Object.fromEntries(plan.map((p) => [p.chainId, p.reads.length]))

  it('plans the exact per-chain contract counts', () => {
    expect(byChain).toEqual({
      1: 2,       // CNC + $CODE
      10: 29,     // 4 ETHGlobal packs + 19 finalists + 6 BuidlGuidl batches
      137: 1,     // ETHernals
      42161: 13,  // 7 Devfolio + 6 BuidlGuidl batches
      8453: 11,   // 3 Devfolio + 3 Base Devfolio + 2 Basecamp + Farcon + $TALENT + vault
      84532: 13,  // 13 Base Learn SBTs
    })
  })

  it('never plans non-POC or non-rpc credentials', () => {
    const slugs = new Set(plan.flatMap((p) => p.reads.map((r) => r.slug)))
    expect(slugs.has('devfolio_hackathons_won')).toBe(false)
    expect(slugs.has('talent_protocol_verified_builder')).toBe(false)
  })

  it('tags the vault read with its method', () => {
    const base = plan.find((p) => p.chainId === 8453)!
    const vault = base.reads.filter((r) => r.slug === 'talent_vault')
    expect(vault).toHaveLength(1)
    expect(vault[0].method).toBe('contract_call')
    expect(vault[0].address).toBe('0x23Ff3256A29847d7EF760943bd6679b565CbdE5a')
  })
})

describe('aggregateChainResults', () => {
  const plan: ChainPlan = {
    chainId: 10,
    reads: [
      { slug: 'eth_global_hacker', method: 'nft_count', address: '0x0000000000000000000000000000000000000001' },
      { slug: 'eth_global_finalist', method: 'nft_count', address: '0x0000000000000000000000000000000000000002' },
      { slug: 'eth_global_finalist', method: 'nft_count', address: '0x0000000000000000000000000000000000000003' },
      { slug: 'buidl_guidl_batches_graduate', method: 'distinct_contracts_owned', address: '0x0000000000000000000000000000000000000004' },
      { slug: 'buidl_guidl_batches_graduate', method: 'distinct_contracts_owned', address: '0x0000000000000000000000000000000000000005' },
    ],
  }

  it('sums balances for nft_count and counts holdings for distinct_contracts_owned', () => {
    const outcomes: ReadOutcome[] = [
      { success: true, value: 2n },  // hacker: balance 2
      { success: true, value: 1n },  // finalist A
      { success: true, value: 1n },  // finalist B
      { success: true, value: 3n },  // batch A owned (balance 3 still = 1 contract)
      { success: true, value: 0n },  // batch B not owned
    ]
    expect(aggregateChainResults(plan, outcomes)).toEqual({
      eth_global_hacker: { status: 'ok', accounts: [2] },
      eth_global_finalist: { status: 'ok', accounts: [2] },
      buidl_guidl_batches_graduate: { status: 'ok', accounts: [1] },
    })
  })

  it('marks only the failing credential unavailable', () => {
    const outcomes: ReadOutcome[] = [
      { success: false, value: null },
      { success: true, value: 1n },
      { success: true, value: 0n },
      { success: true, value: 1n },
      { success: true, value: 1n },
    ]
    const result = aggregateChainResults(plan, outcomes)
    expect(result.eth_global_hacker).toEqual({
      status: 'unavailable',
      reason: 'contract read failed',
    })
    expect(result.eth_global_finalist).toEqual({ status: 'ok', accounts: [1] })
  })

  it('converts erc20 and vault values from wei to whole tokens', () => {
    const erc20Plan: ChainPlan = {
      chainId: 8453,
      reads: [
        { slug: 'talent_protocol_talent_holder', method: 'erc20_balance_whole_tokens', address: '0x0000000000000000000000000000000000000006' },
        { slug: 'talent_vault', method: 'contract_call', address: '0x0000000000000000000000000000000000000007' },
      ],
    }
    const outcomes: ReadOutcome[] = [
      { success: true, value: 900_000_000_000_000_000_000n },              // 900 tokens
      { success: true, value: [1_500_000_000_000_000_000n, 0n, 0n] },      // depositedAmount=1.5
    ]
    expect(aggregateChainResults(erc20Plan, outcomes)).toEqual({
      talent_protocol_talent_holder: { status: 'ok', accounts: [900] },
      talent_vault: { status: 'ok', accounts: [1.5] },
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run test/chains.test.ts`
Expected: FAIL — `@/lib/chains` not found.

- [ ] **Step 3: Implement `src/lib/chains.ts`**

```ts
import {
  createPublicClient,
  fallback,
  http,
  parseAbi,
  type Chain,
  type PublicClient,
} from 'viem'
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon } from 'viem/chains'
import registryJson from '../../spec/badge-registry.json'
import type { CredentialInput, Registry } from './types'

const registry = registryJson as unknown as Registry

export interface PlannedRead {
  slug: string
  method: string
  address: `0x${string}`
}
export interface ChainPlan {
  chainId: number
  reads: PlannedRead[]
}
export interface ReadOutcome {
  success: boolean
  value: bigint | readonly bigint[] | null
}
export interface ChainReadResult {
  values: Record<string, CredentialInput>
  baseBlockNumber: bigint | null
}

const BALANCE_OF_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
// Verbatim from talent-api lib/abi/TalentVault.json; production uses output index 0 / 1e18.
const VAULT_ABI = parseAbi([
  'function userBalanceMeta(address) view returns (uint256 depositedAmount, uint256 lastRewardCalculation, uint256 lastDepositAt)',
])

// Public endpoints only — no API keys anywhere (README ground rule).
const CHAIN_CONFIG: Record<number, { chain: Chain; rpcUrls: string[] }> = {
  1: { chain: mainnet, rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://1rpc.io/eth', 'https://eth.drpc.org'] },
  10: { chain: optimism, rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://1rpc.io/op', 'https://optimism.drpc.org'] },
  137: { chain: polygon, rpcUrls: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic', 'https://polygon.drpc.org'] },
  42161: { chain: arbitrum, rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com', 'https://1rpc.io/arb', 'https://arbitrum.drpc.org'] },
  8453: { chain: base, rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://1rpc.io/base', 'https://base.drpc.org'] },
  84532: { chain: baseSepolia, rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com', 'https://base-sepolia.drpc.org'] },
}

export function buildChainPlan(reg: Registry, pocRpcSlugs: Set<string>): ChainPlan[] {
  const byChain = new Map<number, PlannedRead[]>()
  for (const [slug, entry] of Object.entries(reg.credentials)) {
    if (!pocRpcSlugs.has(slug) || !Array.isArray(entry.contracts)) continue
    for (const contract of entry.contracts) {
      const chainId = reg.chains[contract.chain]
      if (!byChain.has(chainId)) byChain.set(chainId, [])
      byChain.get(chainId)!.push({
        slug,
        method: entry.method,
        address: contract.address as `0x${string}`,
      })
    }
  }
  return [...byChain.entries()].map(([chainId, reads]) => ({ chainId, reads }))
}

function weiToTokens(wei: bigint): number {
  // Keep 4 decimals of precision without float overflow on large balances.
  return Number(wei / 100_000_000_000_000n) / 10_000
}

export function aggregateChainResults(
  plan: ChainPlan,
  outcomes: ReadOutcome[],
): Record<string, CredentialInput> {
  const failed = new Set<string>()
  const totals = new Map<string, number>()

  plan.reads.forEach((read, i) => {
    const outcome = outcomes[i]
    if (!outcome.success || outcome.value === null) {
      failed.add(read.slug)
      return
    }
    const previous = totals.get(read.slug) ?? 0
    switch (read.method) {
      case 'nft_count':
        totals.set(read.slug, previous + Number(outcome.value as bigint))
        break
      case 'distinct_contracts_owned':
        totals.set(read.slug, previous + ((outcome.value as bigint) > 0n ? 1 : 0))
        break
      case 'erc20_balance_whole_tokens':
        totals.set(read.slug, previous + weiToTokens(outcome.value as bigint))
        break
      case 'contract_call': {
        // talent_vault: userBalanceMeta → index 0 (depositedAmount) / 1e18
        const outputs = outcome.value as readonly bigint[]
        totals.set(read.slug, previous + weiToTokens(outputs[0]))
        break
      }
      default:
        failed.add(read.slug)
    }
  })

  const result: Record<string, CredentialInput> = {}
  for (const slug of new Set(plan.reads.map((r) => r.slug))) {
    result[slug] = failed.has(slug)
      ? { status: 'unavailable', reason: 'contract read failed' }
      : { status: 'ok', accounts: [totals.get(slug) ?? 0] }
  }
  return result
}

function clientFor(chainId: number): PublicClient {
  const config = CHAIN_CONFIG[chainId]
  return createPublicClient({
    chain: config.chain,
    transport: fallback(config.rpcUrls.map((url) => http(url, { timeout: 15_000 })), { rank: false }),
  })
}

export async function readChainCredentials(
  address: `0x${string}`,
  pocRpcSlugs: Set<string>,
): Promise<ChainReadResult> {
  const plans = buildChainPlan(registry, pocRpcSlugs)
  const values: Record<string, CredentialInput> = {}
  let baseBlockNumber: bigint | null = null

  await Promise.all(
    plans.map(async (plan) => {
      const chainName = CHAIN_CONFIG[plan.chainId].chain.name
      try {
        const client = clientFor(plan.chainId)
        const [blockNumber, outcomes] = await Promise.all([
          client.getBlockNumber(),
          client.multicall({
            contracts: plan.reads.map((read) => ({
              address: read.address,
              abi: read.method === 'contract_call' ? VAULT_ABI : BALANCE_OF_ABI,
              functionName: read.method === 'contract_call' ? 'userBalanceMeta' : 'balanceOf',
              args: [address],
            })),
            allowFailure: true,
          }),
        ])
        if (plan.chainId === 8453) baseBlockNumber = blockNumber
        Object.assign(
          values,
          aggregateChainResults(
            plan,
            outcomes.map((o) => ({
              success: o.status === 'success',
              value: o.status === 'success' ? (o.result as bigint | readonly bigint[]) : null,
            })),
          ),
        )
      } catch {
        for (const slug of new Set(plan.reads.map((r) => r.slug))) {
          values[slug] = { status: 'unavailable', reason: `${chainName} RPC unavailable` }
        }
      }
    }),
  )

  return { values, baseBlockNumber }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run test/chains.test.ts` then `npm run typecheck`
Expected: PASS / no type errors. (`readChainCredentials` is exercised live in Task 10's manual smoke test — its pure core is what's unit-tested.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/chains.ts test/chains.test.ts
git commit -m "feat: per-chain multicall plan, aggregation, and executor"
```

---

### Task 4: SpeedRun Ethereum fetcher

**Files:**
- Create: `src/lib/speedrun.ts`
- Test: `test/speedrun.test.ts`

**Interfaces:**
- Consumes: `CredentialInput` (Task 1).
- Produces (used by Task 8):
  - `countAcceptedChallenges(body: unknown): number | null` — null when the payload has no `challenges` array (production returns nil there).
  - `readSpeedrunCredential(address: string): Promise<CredentialInput>`
- API contract (verified live 2026-07-24, CORS `*`): `GET https://speedrunethereum.com/api/user-challenges/<lowercased address>` → `{"challenges": [{ "challengeId": "token-vendor", "reviewAction": "ACCEPTED", ... }]}`; unknown/malformed addresses return `200 {"challenges": []}`.
- Counting (mirrors production `DataPoints::BuidlGuidlSpeedrunEthereum`): unique non-null `challengeId` where `reviewAction == "ACCEPTED"`.

- [ ] **Step 1: Write the failing tests**

`test/speedrun.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { countAcceptedChallenges } from '@/lib/speedrun'

describe('countAcceptedChallenges', () => {
  it('counts unique accepted challengeIds', () => {
    expect(
      countAcceptedChallenges({
        challenges: [
          { challengeId: 'simple-nft-example', reviewAction: 'ACCEPTED' },
          { challengeId: 'token-vendor', reviewAction: 'ACCEPTED' },
          { challengeId: 'token-vendor', reviewAction: 'ACCEPTED' },   // resubmission — dedupe
          { challengeId: 'dice-game', reviewAction: 'REJECTED' },
          { challengeId: null, reviewAction: 'ACCEPTED' },             // compact
        ],
      }),
    ).toBe(2)
  })

  it('returns 0 for an empty challenges array', () => {
    expect(countAcceptedChallenges({ challenges: [] })).toBe(0)
  })

  it('returns null when the payload has no challenges array', () => {
    expect(countAcceptedChallenges({})).toBeNull()
    expect(countAcceptedChallenges(null)).toBeNull()
    expect(countAcceptedChallenges({ challenges: 'nope' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run test/speedrun.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/speedrun.ts`**

```ts
import type { CredentialInput } from './types'

const BASE_URL = 'https://speedrunethereum.com/api'

export function countAcceptedChallenges(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const challenges = (body as { challenges?: unknown }).challenges
  if (!Array.isArray(challenges)) return null
  const accepted = challenges
    .filter((c): c is { challengeId?: unknown; reviewAction?: unknown } =>
      typeof c === 'object' && c !== null)
    .filter((c) => c.reviewAction === 'ACCEPTED')
    .map((c) => c.challengeId)
    .filter((id): id is string => typeof id === 'string')
  return new Set(accepted).size
}

export async function readSpeedrunCredential(address: string): Promise<CredentialInput> {
  try {
    const response = await fetch(`${BASE_URL}/user-challenges/${address.toLowerCase()}`)
    if (!response.ok) {
      return { status: 'unavailable', reason: `SpeedRun Ethereum API error (${response.status})` }
    }
    const count = countAcceptedChallenges(await response.json())
    if (count === null) {
      return { status: 'unavailable', reason: 'SpeedRun Ethereum API returned an unexpected shape' }
    }
    return { status: 'ok', accounts: [count] }
  } catch {
    return { status: 'unavailable', reason: 'SpeedRun Ethereum API unreachable' }
  }
}
```

- [ ] **Step 4: Run — expect pass, then commit**

Run: `npx vitest run test/speedrun.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/speedrun.ts test/speedrun.test.ts
git commit -m "feat: SpeedRun Ethereum accepted-challenge fetcher"
```

---

### Task 5: easscan Verified Builder fetcher

**Files:**
- Create: `src/lib/easscan.ts`
- Test: `test/easscan.test.ts`

**Interfaces:**
- Consumes: `CredentialInput` (Task 1), registry `schema_uid`, viem's `getAddress`.
- Produces (used by Task 8):
  - `countDistinctAttesters(responses: unknown[]): number | null` — null if any response is malformed.
  - `readVerifiedBuilder(address: string): Promise<CredentialInput>`
- Endpoints (verified live 2026-07-24, both CORS `*`): POST `https://base.easscan.org/graphql` and `https://celo.easscan.org/graphql`.
- Production parity notes: recipient must be the **checksummed** address; attestations with nonzero `revocationTime` are excluded; the value is the count of **distinct attesters**, unioned across networks. (Known production quirk: a Ruby `any?` short-circuit means prod effectively only queries Base; the spec says both networks, and this POC follows the spec.)

- [ ] **Step 1: Write the failing tests**

`test/easscan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { countDistinctAttesters, VERIFIED_BUILDER_QUERY } from '@/lib/easscan'

const response = (attestations: unknown) => ({ data: { attestations } })

describe('countDistinctAttesters', () => {
  it('unions attesters across networks and dedupes', () => {
    expect(
      countDistinctAttesters([
        response([
          { attester: '0xAAA0000000000000000000000000000000000001', revocationTime: 0 },
          { attester: '0xAAA0000000000000000000000000000000000002', revocationTime: null },
        ]),
        response([
          { attester: '0xAAA0000000000000000000000000000000000001', revocationTime: 0 }, // dup on other chain
          { attester: '0xAAA0000000000000000000000000000000000003', revocationTime: 0 },
        ]),
      ]),
    ).toBe(3)
  })

  it('excludes revoked attestations (nonzero revocationTime)', () => {
    expect(
      countDistinctAttesters([
        response([
          { attester: '0xAAA0000000000000000000000000000000000001', revocationTime: 1_700_000_000 },
          { attester: '0xAAA0000000000000000000000000000000000002', revocationTime: 0 },
        ]),
      ]),
    ).toBe(1)
  })

  it('returns null on a malformed response', () => {
    expect(countDistinctAttesters([{ errors: [{ message: 'boom' }] }])).toBeNull()
    expect(countDistinctAttesters([response('not-an-array')])).toBeNull()
  })

  it('counts zero attestations as 0', () => {
    expect(countDistinctAttesters([response([]), response([])])).toBe(0)
  })
})

describe('VERIFIED_BUILDER_QUERY', () => {
  it('filters by recipient and schemaId only (production parity)', () => {
    expect(VERIFIED_BUILDER_QUERY).toContain('recipient')
    expect(VERIFIED_BUILDER_QUERY).toContain('schemaId')
    expect(VERIFIED_BUILDER_QUERY).not.toContain('attester:')
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run test/easscan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/easscan.ts`**

```ts
import { getAddress } from 'viem'
import registryJson from '../../spec/badge-registry.json'
import type { CredentialInput, Registry } from './types'

const registry = registryJson as unknown as Registry

const ENDPOINTS = [
  'https://base.easscan.org/graphql',
  'https://celo.easscan.org/graphql',
]

// Mirrors talent-api lib/eas_scan_graphql/queries.rb GET_WALLET_ATTESTATIONS_FOR_SCHEMA_QUERY.
export const VERIFIED_BUILDER_QUERY = `query($recipient: String, $schema_id: String) {
  attestations(where: {
    recipient: { equals: $recipient },
    schemaId: { equals: $schema_id }
  }) {
    id
    attester
    revocationTime
    timeCreated
  }
}`

interface Attestation {
  attester?: unknown
  revocationTime?: unknown
}

export function countDistinctAttesters(responses: unknown[]): number | null {
  const attesters = new Set<string>()
  for (const raw of responses) {
    if (typeof raw !== 'object' || raw === null) return null
    const attestations = (raw as { data?: { attestations?: unknown } }).data?.attestations
    if (!Array.isArray(attestations)) return null
    for (const a of attestations as Attestation[]) {
      const revoked = typeof a.revocationTime === 'number' && a.revocationTime !== 0
      if (!revoked && typeof a.attester === 'string') attesters.add(a.attester.toLowerCase())
    }
  }
  return attesters.size
}

export async function readVerifiedBuilder(address: string): Promise<CredentialInput> {
  const schemaUid = registry.credentials.talent_protocol_verified_builder.schema_uid
  let recipient: string
  try {
    recipient = getAddress(address) // easscan stores checksummed recipients
  } catch {
    return { status: 'unavailable', reason: 'invalid wallet address' }
  }

  try {
    const responses = await Promise.all(
      ENDPOINTS.map(async (endpoint) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: VERIFIED_BUILDER_QUERY,
            variables: { recipient, schema_id: schemaUid },
          }),
        })
        if (!response.ok) throw new Error(`easscan ${response.status}`)
        return response.json()
      }),
    )
    const count = countDistinctAttesters(responses)
    if (count === null) {
      return { status: 'unavailable', reason: 'easscan returned an unexpected shape' }
    }
    return { status: 'ok', accounts: [count] }
  } catch {
    return { status: 'unavailable', reason: 'easscan (Base/Celo) unreachable' }
  }
}
```

- [ ] **Step 4: Run — expect pass, then commit**

Run: `npx vitest run test/easscan.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/easscan.ts test/easscan.test.ts
git commit -m "feat: verified-builder attester count via easscan (Base+Celo)"
```

---

### Task 6: GitHub fetcher

**Files:**
- Create: `src/lib/github.ts`
- Test: `test/github.test.ts`

**Interfaces:**
- Consumes: `CredentialInput` (Task 1).
- Produces (used by Task 8):
  - `GITHUB_SLUGS` — the 5 slugs as a readonly array.
  - `aggregateRepoStats(repos: unknown[]): { stars: number; forks: number }`
  - `readGithubCredentials(handle: string | null, fetchFn?: typeof fetch): Promise<Record<string, CredentialInput>>` — `fetchFn` defaults to global `fetch`; injectable for tests.
- Behavior: `null`/empty handle → every GitHub slug gets `{ status: 'ok', accounts: [] }` (scored 0, "not provided", does NOT block attestation — the handle is optional by design). 404 → unavailable "GitHub user not found". 403/429 → unavailable "GitHub rate limit exceeded — try again in an hour". Repos paginate at 100/page until a short page, hard cap 20 pages.

- [ ] **Step 1: Write the failing tests**

`test/github.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aggregateRepoStats, readGithubCredentials, GITHUB_SLUGS } from '@/lib/github'

const userPayload = {
  created_at: '2020-04-25T18:00:00Z',
  followers: 170,
  public_repos: 16,
}
const repoPage = [
  { stargazers_count: 40, forks_count: 30 },
  { stargazers_count: 24, forks_count: 19 },
]

function fakeFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.entries(routes).find(([key]) => url.includes(key))
    if (!match) throw new Error(`unexpected fetch: ${url}`)
    const { status, body } = match[1]
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }) as typeof fetch
}

describe('aggregateRepoStats', () => {
  it('sums stargazers and forks', () => {
    expect(aggregateRepoStats(repoPage)).toEqual({ stars: 64, forks: 49 })
  })
  it('ignores malformed entries', () => {
    expect(aggregateRepoStats([...repoPage, null, 'x', {}])).toEqual({ stars: 64, forks: 49 })
  })
})

describe('readGithubCredentials', () => {
  it('returns empty ok inputs when no handle is given', async () => {
    const result = await readGithubCredentials(null)
    for (const slug of GITHUB_SLUGS) {
      expect(result[slug]).toEqual({ status: 'ok', accounts: [] })
    }
  })

  it('maps the five metrics from the API payloads', async () => {
    const result = await readGithubCredentials('octocat', fakeFetch({
      '/users/octocat/repos': { status: 200, body: repoPage },
      '/users/octocat': { status: 200, body: userPayload },
    }))
    expect(result.github_account_age).toEqual({
      status: 'ok',
      accounts: [Math.floor(Date.parse('2020-04-25T18:00:00Z') / 1000)],
    })
    expect(result.github_followers).toEqual({ status: 'ok', accounts: [170] })
    expect(result.github_stars).toEqual({ status: 'ok', accounts: [64] })
    expect(result.github_forks).toEqual({ status: 'ok', accounts: [49] })
    expect(result.github_repositories).toEqual({ status: 'ok', accounts: [16] })
  })

  it('maps 404 to user-not-found on every slug', async () => {
    const result = await readGithubCredentials('nobody', fakeFetch({
      '/users/nobody': { status: 404, body: {} },
    }))
    for (const slug of GITHUB_SLUGS) {
      expect(result[slug]).toEqual({ status: 'unavailable', reason: 'GitHub user not found' })
    }
  })

  it('maps 403 to the rate-limit message', async () => {
    const result = await readGithubCredentials('octocat', fakeFetch({
      '/users/octocat': { status: 403, body: {} },
    }))
    expect(result.github_stars).toEqual({
      status: 'unavailable',
      reason: 'GitHub rate limit exceeded — try again in an hour',
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run test/github.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/github.ts`**

```ts
import type { CredentialInput } from './types'

export const GITHUB_SLUGS = [
  'github_account_age',
  'github_followers',
  'github_stars',
  'github_forks',
  'github_repositories',
] as const

const API = 'https://api.github.com'
const MAX_REPO_PAGES = 20

export function aggregateRepoStats(repos: unknown[]): { stars: number; forks: number } {
  let stars = 0
  let forks = 0
  for (const repo of repos) {
    if (typeof repo !== 'object' || repo === null) continue
    const r = repo as { stargazers_count?: unknown; forks_count?: unknown }
    if (typeof r.stargazers_count === 'number') stars += r.stargazers_count
    if (typeof r.forks_count === 'number') forks += r.forks_count
  }
  return { stars, forks }
}

function allSlugs(input: CredentialInput): Record<string, CredentialInput> {
  return Object.fromEntries(GITHUB_SLUGS.map((slug) => [slug, input]))
}

export async function readGithubCredentials(
  handle: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, CredentialInput>> {
  if (!handle) return allSlugs({ status: 'ok', accounts: [] })

  try {
    const userResponse = await fetchFn(`${API}/users/${encodeURIComponent(handle)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (userResponse.status === 404) {
      return allSlugs({ status: 'unavailable', reason: 'GitHub user not found' })
    }
    if (userResponse.status === 403 || userResponse.status === 429) {
      return allSlugs({
        status: 'unavailable',
        reason: 'GitHub rate limit exceeded — try again in an hour',
      })
    }
    if (!userResponse.ok) {
      return allSlugs({ status: 'unavailable', reason: `GitHub API error (${userResponse.status})` })
    }
    const user = (await userResponse.json()) as {
      created_at: string
      followers: number
      public_repos: number
    }

    const repos: unknown[] = []
    for (let page = 1; page <= MAX_REPO_PAGES; page++) {
      const pageResponse = await fetchFn(
        `${API}/users/${encodeURIComponent(handle)}/repos?per_page=100&page=${page}`,
        { headers: { Accept: 'application/vnd.github+json' } },
      )
      if (!pageResponse.ok) {
        return allSlugs({
          status: 'unavailable',
          reason:
            pageResponse.status === 403 || pageResponse.status === 429
              ? 'GitHub rate limit exceeded — try again in an hour'
              : `GitHub API error (${pageResponse.status})`,
        })
      }
      const pageRepos = (await pageResponse.json()) as unknown[]
      repos.push(...pageRepos)
      if (pageRepos.length < 100) break
    }
    const { stars, forks } = aggregateRepoStats(repos)

    return {
      github_account_age: { status: 'ok', accounts: [Math.floor(Date.parse(user.created_at) / 1000)] },
      github_followers: { status: 'ok', accounts: [user.followers] },
      github_stars: { status: 'ok', accounts: [stars] },
      github_forks: { status: 'ok', accounts: [forks] },
      github_repositories: { status: 'ok', accounts: [user.public_repos] },
    }
  } catch {
    return allSlugs({ status: 'unavailable', reason: 'GitHub API unreachable' })
  }
}
```

- [ ] **Step 4: Run — expect pass, then commit**

Run: `npx vitest run test/github.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/github.ts test/github.test.ts
git commit -m "feat: unauthenticated GitHub metrics fetcher"
```

---

### Task 7: Orchestration — gatherInputs

**Files:**
- Create: `src/lib/orchestrate.ts`
- Test: `test/orchestrate.test.ts`

**Interfaces:**
- Consumes: `readChainCredentials` (Task 3), `readSpeedrunCredential` (Task 4), `readVerifiedBuilder` (Task 5), `readGithubCredentials` (Task 6), `Spec` + input types (Task 1).
- Produces (used by Task 10 UI):

```ts
export interface GatherResult {
  inputs: EngineInputs
  baseBlockNumber: bigint | null
}
export interface Fetchers {
  chains: (address: `0x${string}`, pocRpcSlugs: Set<string>) => Promise<ChainReadResult>
  github: (handle: string | null) => Promise<Record<string, CredentialInput>>
  speedrun: (address: string) => Promise<CredentialInput>
  verifiedBuilder: (address: string) => Promise<CredentialInput>
}
export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers?: Partial<Fetchers>,   // test seam; defaults to the real modules
): Promise<GatherResult>
```

- [ ] **Step 1: Write the failing tests**

`test/orchestrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gatherInputs } from '@/lib/orchestrate'
import type { CredentialInput } from '@/lib/types'

const ok = (n: number): CredentialInput => ({ status: 'ok', accounts: [n] })

describe('gatherInputs', () => {
  it('merges all four sources under the right slugs', async () => {
    const { inputs, baseBlockNumber } = await gatherInputs('0x0000000000000000000000000000000000000001', 'octocat', {
      chains: async () => ({
        values: { eth_global_hacker: ok(1), talent_vault: ok(2) },
        baseBlockNumber: 123n,
      }),
      github: async () => ({ github_followers: ok(170) }),
      speedrun: async () => ok(4),
      verifiedBuilder: async () => ok(2),
    })
    expect(inputs.values.eth_global_hacker).toEqual(ok(1))
    expect(inputs.values.github_followers).toEqual(ok(170))
    expect(inputs.values.buidl_guidl_speedrun_ethereum).toEqual(ok(4))
    expect(inputs.values.talent_protocol_verified_builder).toEqual(ok(2))
    expect(baseBlockNumber).toBe(123n)
    expect(inputs.computedAt).toBeGreaterThan(1_750_000_000)
  })

  it('captures computedAt once, in unix seconds', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { inputs } = await gatherInputs('0x0000000000000000000000000000000000000001', null, {
      chains: async () => ({ values: {}, baseBlockNumber: null }),
      github: async () => ({}),
      speedrun: async () => ok(0),
      verifiedBuilder: async () => ok(0),
    })
    expect(inputs.computedAt).toBeGreaterThanOrEqual(before)
    expect(inputs.computedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run test/orchestrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/orchestrate.ts`**

```ts
import specJson from '../../spec/spec.json'
import { readChainCredentials, type ChainReadResult } from './chains'
import { readGithubCredentials } from './github'
import { readSpeedrunCredential } from './speedrun'
import { readVerifiedBuilder } from './easscan'
import type { CredentialInput, EngineInputs, Spec } from './types'

const spec = specJson as Spec

export interface GatherResult {
  inputs: EngineInputs
  baseBlockNumber: bigint | null
}

export interface Fetchers {
  chains: (address: `0x${string}`, pocRpcSlugs: Set<string>) => Promise<ChainReadResult>
  github: (handle: string | null) => Promise<Record<string, CredentialInput>>
  speedrun: (address: string) => Promise<CredentialInput>
  verifiedBuilder: (address: string) => Promise<CredentialInput>
}

const defaultFetchers: Fetchers = {
  chains: readChainCredentials,
  github: readGithubCredentials,
  speedrun: readSpeedrunCredential,
  verifiedBuilder: readVerifiedBuilder,
}

export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
): Promise<GatherResult> {
  const f = { ...defaultFetchers, ...fetchers }
  const computedAt = Math.floor(Date.now() / 1000)
  const pocRpcSlugs = new Set(
    spec.credentials.filter((c) => c.poc && c.tier === 'rpc').map((c) => c.slug),
  )

  const [chainResult, github, speedrun, verifiedBuilder] = await Promise.all([
    f.chains(address, pocRpcSlugs),
    f.github(githubHandle),
    f.speedrun(address),
    f.verifiedBuilder(address),
  ])

  return {
    inputs: {
      computedAt,
      values: {
        ...chainResult.values,
        ...github,
        buidl_guidl_speedrun_ethereum: speedrun,
        talent_protocol_verified_builder: verifiedBuilder,
      },
    },
    baseBlockNumber: chainResult.baseBlockNumber,
  }
}
```

- [ ] **Step 4: Run full suite — expect pass, then commit**

Run: `npm test && npm run typecheck`
Expected: every suite green.

```bash
git add src/lib/orchestrate.ts test/orchestrate.test.ts
git commit -m "feat: parallel input gathering across all four sources"
```

---

### Task 8: Wallet providers — RainbowKit wiring

**Files:**
- Create: `src/lib/wallet.ts`
- Create: `src/app/providers.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: RainbowKit/wagmi/react-query packages (installed).
- Produces: `<Providers>` client component wrapping the app; `WALLETCONNECT_PROJECT_ID` constant. Task 11 relies on wagmi hooks working anywhere under the layout.

- [ ] **Step 1: Create `src/lib/wallet.ts`**

```ts
// WalletConnect Cloud project id. This is a PUBLIC client identifier (it ships
// in the browser bundle by design) — hardcoding it does not violate the
// zero-secrets ground rule. Injected wallets (MetaMask etc.) work even with
// this placeholder; WalletConnect QR pairing needs the real id.
// HUMAN ACTION: create a free project at https://cloud.reown.com and replace.
export const WALLETCONNECT_PROJECT_ID = 'OPEN_BUILDER_SCORE_POC_PLACEHOLDER'
```

- [ ] **Step 2: Create `src/app/providers.tsx`**

```tsx
'use client'

import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { WALLETCONNECT_PROJECT_ID } from '@/lib/wallet'

const config = getDefaultConfig({
  appName: 'Open Builder Score',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [baseSepolia, base],
  ssr: true,
})

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

- [ ] **Step 3: Modify `src/app/layout.tsx`**

Update the metadata object and wrap children (keep the font setup as scaffolded):

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Note: the root layout stays a Server Component (it must export `metadata`); `providers.tsx` is the client boundary. RainbowKit's stylesheet is imported inside the client module — Turbopack honors JS import order strictly, and this keeps it after `globals.css`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds. If Turbopack reports "Module not found" for optional deps (`pino-pretty`, `lokijs`, `encoding`), do NOT add webpack config — add to `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    ignoreIssue: [{ description: /Module not found.*(pino-pretty|lokijs|encoding)/ }],
  },
};

export default nextConfig;
```

(Only add this if the warnings actually appear, and check the exact `ignoreIssue` option shape in `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopackIgnoreIssue.md` first — it's new in 16.2.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet.ts src/app/providers.tsx src/app/layout.tsx next.config.ts
git commit -m "feat: RainbowKit + wagmi + react-query providers"
```

---

### Task 9: EAS module — constants, schema UID, attest

**Files:**
- Create: `src/lib/eas.ts`
- Test: `test/eas.test.ts`
- Modify: `package.json` (add `ethers` as a direct dependency)

**Interfaces:**
- Consumes: eas-sdk, ethers (BrowserProvider adapter — eas-sdk 2.9.1 has no viem signer), viem `keccak256`/`encodePacked`, wagmi's `WalletClient` type.
- Produces (used by Task 11):

```ts
export const EAS_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000021'
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020'
export const ATTEST_SCHEMA =
  'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number'
export const ATTEST_CHAIN_ID: number = 84532    // Base Sepolia first; flip to 8453 after mainnet registration
                                                // (typed number, not literal — literal typing makes the
                                                // explorer-URL comparison a TS2367 error after the flip)
export function computeSchemaUid(schema: string, resolver: `0x${string}`, revocable: boolean): `0x${string}`
export const ATTEST_SCHEMA_UID: `0x${string}`   // computeSchemaUid(ATTEST_SCHEMA, ZERO, true)
export interface AttestParams {
  walletClient: WalletClient                     // from wagmi useWalletClient
  recipient: `0x${string}`
  specVersion: string
  githubHandle: string | null
  score: number
  computedAt: number
  blockNumber: bigint
}
export async function attestScore(params: AttestParams): Promise<`0x${string}`>  // returns attestation UID
```

- [ ] **Step 1: Add ethers as a direct dependency**

Run: `npm install ethers@^6.17.0`
Expected: no new packages beyond metadata (it's already in the tree via eas-sdk); package.json gains the dependency. Direct dependency because we import `BrowserProvider`/`JsonRpcSigner` from it — never import from a transitive dep.

- [ ] **Step 2: Write the failing tests**

`test/eas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeSchemaUid, ATTEST_SCHEMA, ATTEST_SCHEMA_UID } from '@/lib/eas'

describe('schema UID', () => {
  it('is deterministic keccak256(schema ++ resolver ++ revocable)', () => {
    // EAS SchemaRegistry: uid = keccak256(abi.encodePacked(schema, resolver, revocable))
    const uid = computeSchemaUid(
      ATTEST_SCHEMA,
      '0x0000000000000000000000000000000000000000',
      true,
    )
    expect(uid).toMatch(/^0x[0-9a-f]{64}$/)
    expect(uid).toBe(ATTEST_SCHEMA_UID)
  })

  it('changes when revocable changes', () => {
    const revocable = computeSchemaUid(ATTEST_SCHEMA, '0x0000000000000000000000000000000000000000', true)
    const irrevocable = computeSchemaUid(ATTEST_SCHEMA, '0x0000000000000000000000000000000000000000', false)
    expect(revocable).not.toBe(irrevocable)
  })

  it('uses the README-proposed field list', () => {
    expect(ATTEST_SCHEMA).toBe(
      'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number',
    )
  })
})
```

- [ ] **Step 3: Run — expect failure**

Run: `npx vitest run test/eas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/eas.ts`**

```ts
import { EAS, NO_EXPIRATION, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { encodePacked, keccak256, zeroAddress } from 'viem'
import type { WalletClient } from 'viem'

// OP-stack predeploys — same address on Base and Base Sepolia.
// Verified against EAS docs at registration time (Task 11).
export const EAS_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000021'
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020'

// README-proposed schema. EAS canonical form: comma-separated, no spaces.
export const ATTEST_SCHEMA =
  'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number'

export const ATTEST_CHAIN_ID: number = 84532 // Base Sepolia first; switch to 8453 (Base) post-registration

export function computeSchemaUid(
  schema: string,
  resolver: `0x${string}`,
  revocable: boolean,
): `0x${string}` {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]))
}

// Deterministic: identical on every chain for (schema, zero resolver, revocable=true).
// Registration (Task 11) must produce exactly this UID or the config is wrong.
export const ATTEST_SCHEMA_UID = computeSchemaUid(ATTEST_SCHEMA, zeroAddress, true)

export interface AttestParams {
  walletClient: WalletClient
  recipient: `0x${string}`
  specVersion: string
  githubHandle: string | null
  score: number
  computedAt: number
  blockNumber: bigint
}

function walletClientToSigner(walletClient: WalletClient): JsonRpcSigner {
  const { account, chain, transport } = walletClient
  if (!account || !chain) throw new Error('wallet not connected')
  const provider = new BrowserProvider(transport, { chainId: chain.id, name: chain.name })
  return new JsonRpcSigner(provider, account.address)
}

export async function attestScore(params: AttestParams): Promise<`0x${string}`> {
  const signer = walletClientToSigner(params.walletClient)
  const eas = new EAS(EAS_CONTRACT_ADDRESS)
  eas.connect(signer)

  const encoder = new SchemaEncoder(ATTEST_SCHEMA)
  const data = encoder.encodeData([
    { name: 'spec_version', value: params.specVersion, type: 'string' },
    { name: 'wallet', value: params.recipient, type: 'address' },
    { name: 'github_handle', value: params.githubHandle ?? '', type: 'string' },
    { name: 'score', value: params.score, type: 'uint16' },
    { name: 'computed_at', value: BigInt(params.computedAt), type: 'uint64' },
    { name: 'block_number', value: params.blockNumber, type: 'uint64' },
  ])

  const tx = await eas.attest({
    schema: ATTEST_SCHEMA_UID,
    data: {
      recipient: params.recipient,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      data,
    },
  })
  return (await tx.wait()) as `0x${string}`
}
```

- [ ] **Step 5: Run — expect pass, then commit**

Run: `npx vitest run test/eas.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/lib/eas.ts test/eas.test.ts package.json package-lock.json
git commit -m "feat: EAS attest module with deterministic schema UID"
```

---

### Task 10: The UI — form, score view, credential cards

**Files:**
- Create: `src/components/credential-card.tsx`
- Replace: `src/app/page.tsx`

**Interfaces:**
- Consumes: `gatherInputs` (Task 7), `computeScore` (Task 2), `CredentialResult`/`ScoreResult`/`GatherResult` types, viem `isAddress`.
- Produces: `CredentialCard({ result }: { result: CredentialResult })`; page-level state shape `{ score: ScoreResult; gather: GatherResult; address: \`0x${string}\`; githubHandle: string | null }` that Task 11's AttestPanel receives.

- [ ] **Step 1: Create `src/components/credential-card.tsx`**

```tsx
import type { CredentialResult } from '@/lib/types'

const stateStyles: Record<CredentialResult['state'], string> = {
  earned: 'border-emerald-500/40 bg-emerald-500/5',
  not_earned: 'border-zinc-700 bg-zinc-900/40 opacity-70',
  unavailable: 'border-amber-500/40 bg-amber-500/5',
}

export function CredentialCard({ result }: { result: CredentialResult }) {
  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-1 ${stateStyles[result.state]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-sm">{result.name}</h3>
        <span className="font-mono text-sm tabular-nums shrink-0">
          {result.points}/{result.maxScore}
        </span>
      </div>
      {result.state === 'unavailable' ? (
        <p className="text-xs text-amber-500">Couldn&apos;t check: {result.unavailableReason}</p>
      ) : result.rawValue === null ? (
        <p className="text-xs text-zinc-500">Not earned</p>
      ) : (
        <>
          <p className="text-xs text-zinc-400">
            Raw value: <span className="font-mono">{result.rawValue}</span>
          </p>
          <p className="text-xs text-zinc-500 font-mono">{result.formula}</p>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { isAddress } from 'viem'
import specJson from '../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type GatherResult } from '@/lib/orchestrate'
import type { ScoreResult, Spec } from '@/lib/types'
import { CredentialCard } from '@/components/credential-card'

const spec = specJson as Spec

interface Scored {
  score: ScoreResult
  gather: GatherResult
  address: `0x${string}`
  githubHandle: string | null
}

export default function Home() {
  const [addressInput, setAddressInput] = useState('')
  const [githubInput, setGithubInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scored, setScored] = useState<Scored | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const address = addressInput.trim()
    if (!isAddress(address)) {
      setError('That doesn’t look like an EVM address (0x…, 40 hex chars).')
      return
    }
    const githubHandle = githubInput.trim() || null
    setError(null)
    setLoading(true)
    setScored(null)
    try {
      const gather = await gatherInputs(address, githubHandle)
      setScored({ score: computeScore(gather.inputs, spec), gather, address, githubHandle })
    } catch {
      setError('Something went wrong while gathering data. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Open Builder Score</h1>
        <p className="text-sm text-zinc-400">
          Enter a wallet and get a Builder Score computed entirely in your browser from public
          data — no backend, no accounts. Spec v{spec.version}.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
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
          disabled={loading}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Reading public data…' : 'Compute score'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      {scored && (
        <section className="flex flex-col gap-6">
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-bold tabular-nums">{scored.score.total}</span>
            <span className="text-zinc-500">/ {scored.score.maxTotal}</span>
            {!scored.score.complete && (
              <span className="text-xs text-amber-500">
                partial — some sources couldn&apos;t be checked
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scored.score.perCredential.map((result) => (
              <CredentialCard key={result.slug} result={result} />
            ))}
          </div>

          <p className="text-xs text-zinc-600">
            github_repositories approximates production (public repo count vs. repos
            contributed-to). Computed at{' '}
            {new Date(scored.gather.inputs.computedAt * 1000).toISOString()}
            {scored.gather.baseBlockNumber !== null &&
              `, Base block ${scored.gather.baseBlockNumber}`}
            .
          </p>
        </section>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Build and typecheck**

Run: `npm run build && npm run typecheck`
Expected: clean build, `/` prerendered as static.

- [ ] **Step 4: Manual smoke test (REQUIRED — this is the product)**

Run: `npm run dev`, open http://localhost:3000 and verify:
1. Address `0xb4f53bd85c00ef22946d24ae26bc38ac64f5e7b1` (known SpeedRun history) + GitHub handle `octocat` → a score renders; the Speed Run Ethereum card shows nonzero points; GitHub cards show values; formula strings are visible on earned cards.
2. An address with no credentials (e.g. `0x0000000000000000000000000000000000000001`) → score 0, everything "Not earned", NO unavailable cards (public RPCs healthy).
3. Empty GitHub handle → GitHub cards show "Not earned", and the result still reports complete (no partial warning).
4. Open DevTools Network tab: confirm requests go only to public RPCs, api.github.com, speedrunethereum.com, and the two easscan endpoints. Zero requests to any server of ours.

If a specific public RPC consistently fails, reorder/replace it in `CHAIN_CONFIG` — that list is the only tuning knob.

- [ ] **Step 5: Commit**

```bash
git add src/components/credential-card.tsx src/app/page.tsx
git commit -m "feat: self-scoring page with per-credential breakdown"
```

---

### Task 11: Attestation — schema registration + attest panel

**Files:**
- Create: `src/components/attest-panel.tsx`
- Modify: `src/app/page.tsx` (render the panel)
- Modify: `src/lib/wallet.ts` (real WalletConnect projectId, if available)

**Interfaces:**
- Consumes: `attestScore`, `ATTEST_SCHEMA_UID`, `ATTEST_CHAIN_ID` (Task 9); wagmi `useAccount`, `useWalletClient`, `useSwitchChain`; RainbowKit `ConnectButton`; the `Scored` page state (Task 10).
- Produces: `AttestPanel({ scored }: { scored: Scored })` — exported from `src/components/attest-panel.tsx`; the `Scored` type moves to be exported from `src/app/page.tsx`.

- [ ] **Step 1: HUMAN ACTION — register the schema on Base Sepolia**

The user (with any funded Base Sepolia wallet) registers the schema:

1. Open https://base-sepolia.easscan.org/schema/create
2. Add fields IN THIS ORDER (names exact): `spec_version` (string), `wallet` (address), `github_handle` (string), `score` (uint16), `computed_at` (uint64), `block_number` (uint64)
3. Resolver: none (zero address). Revocable: **yes**.
4. Submit and note the resulting schema UID.
5. **Verify determinism:** the UID easscan shows MUST equal the `ATTEST_SCHEMA_UID` printed by `npx vitest run test/eas.test.ts` (add a temporary `console.log(ATTEST_SCHEMA_UID)` or read it from the test output). If they differ, easscan normalized the schema string differently — update `ATTEST_SCHEMA` in `src/lib/eas.ts` to easscan's exact string until the computed UID matches, and re-run the eas tests.

Base **mainnet** registration is deliberately deferred until the POC is validated on Sepolia; when done, flip `ATTEST_CHAIN_ID` to `8453`.

- [ ] **Step 2: Create `src/components/attest-panel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { attestScore, ATTEST_CHAIN_ID } from '@/lib/eas'
import type { Scored } from '@/app/page'

const EXPLORER_BASE =
  ATTEST_CHAIN_ID === 84532
    ? 'https://base-sepolia.easscan.org/attestation/view/'
    : 'https://base.easscan.org/attestation/view/'

export function AttestPanel({ scored }: { scored: Scored }) {
  const { address: connected, chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attestationUid, setAttestationUid] = useState<string | null>(null)

  if (!scored.score.complete || scored.gather.baseBlockNumber === null) {
    return (
      <p className="text-xs text-amber-500">
        Attestation is disabled while any source is unavailable — an attested score must be
        computed from complete data.
      </p>
    )
  }

  async function handleAttest() {
    if (!walletClient) return
    setBusy(true)
    setError(null)
    try {
      if (chainId !== ATTEST_CHAIN_ID) await switchChainAsync({ chainId: ATTEST_CHAIN_ID })
      const uid = await attestScore({
        walletClient,
        recipient: scored.address,
        specVersion: '0.1.0-poc',
        githubHandle: scored.githubHandle,
        score: scored.score.total,
        computedAt: scored.gather.inputs.computedAt,
        blockNumber: scored.gather.baseBlockNumber!,
      })
      setAttestationUid(uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attestation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
      <h2 className="text-sm font-medium">Attest this score onchain</h2>
      <p className="text-xs text-zinc-500">
        You sign, you pay. The attestation embeds the spec version, score, and the as-of anchor
        so anyone can recompute and verify it.
      </p>
      <div className="flex items-center gap-3">
        <ConnectButton showBalance={false} />
        {connected && (
          <button
            onClick={handleAttest}
            disabled={busy || !walletClient}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Waiting for wallet…' : 'Attest onchain'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400 break-all">{error}</p>}
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
    </div>
  )
}
```

- [ ] **Step 3: Wire the panel into `src/app/page.tsx`**

Export the `Scored` interface (change `interface Scored` to `export interface Scored`), add the import, and render the panel after the footnote paragraph inside the results `<section>`:

```tsx
import { AttestPanel } from '@/components/attest-panel'
```

```tsx
          <AttestPanel scored={scored} />
```

- [ ] **Step 4: Build, typecheck, full test run**

Run: `npm run build && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 5: Manual end-to-end attest on Base Sepolia (REQUIRED)**

`npm run dev` → compute a score for YOUR OWN wallet → connect that wallet (Base Sepolia, funded with test ETH) → Attest onchain → approve in wallet → the easscan link opens and shows the attestation with decoded `spec_version`, `score`, `computed_at`, `block_number`. Wrong-network and user-rejection paths: reject the tx once and confirm the inline error renders (no toast, no crash).

- [ ] **Step 6: Commit**

```bash
git add src/components/attest-panel.tsx src/app/page.tsx src/lib/wallet.ts src/lib/eas.ts
git commit -m "feat: one-click EAS attestation on Base Sepolia"
```

---

### Task 12: Deploy to Vercel + README truth-up

**Files:**
- Modify: `README.md` (phase checkboxes, schema UID, live URL)

- [ ] **Step 1: HUMAN ACTION — deploy**

The user connects the repo to Vercel (dashboard → Import Git Repository, all defaults; or `npx vercel` if they prefer the CLI). **No env vars are configured — that's the point.** Note the production URL.

- [ ] **Step 2: Verify production**

On the deployed URL repeat Task 10 Step 4's checks 1 and 4 (score renders; Network tab shows only public endpoints). Attest once on Sepolia from production.

- [ ] **Step 3: Update README**

- Tick phases 3–8 checkboxes (`- [x]`).
- Under "Remaining lookups", replace the three items with their resolved values (SpeedRun API URL, `userBalanceMeta` shape, easscan endpoints — all verified with CORS open) or delete the section and fold the facts into the relevant phase lines.
- Record the registered schema UID and the production URL.

- [ ] **Step 4: Final full verification + commit**

Run: `npm test && npm run build && npx eslint .`
Expected: all green.

```bash
git add README.md
git commit -m "docs: mark POC phases complete, record schema UID and live URL"
```

---

## Verification Summary

| Layer | How it's verified |
|---|---|
| Engine math | Golden vectors hand-computed from spec.json (total 174/277), conversion unit tests, calc-mode order tests |
| Spec data | Cross-consistency suite (spec ↔ registry ↔ constants) |
| Chain reads | Pure plan/aggregate unit tests with exact per-chain counts; live smoke in Task 10 |
| Fetchers | Parser/aggregator unit tests with injected fetch; error-path mapping tests |
| UI | Manual smoke with known-credentialed wallet + empty wallet + DevTools network audit |
| Attestation | Deterministic UID test vs easscan registration; manual e2e attest on Base Sepolia |
| No-backend claim | DevTools network audit locally and on production |
