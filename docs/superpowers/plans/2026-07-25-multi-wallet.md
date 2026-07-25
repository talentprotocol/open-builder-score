# Multi-Wallet Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score across up to 5 wallets at once (badges on one, $TALENT on another, all counted) while keeping attestation single-wallet so recompute-and-verify stays honest.

**Architecture:** Aggregation is pure input merging — `CredentialInput.accounts` is already `number[]` and the engine already applies `sum_all`/`max_value` across accounts, so a new `gatherMultiInputs` fans the existing fetchers out per wallet and concatenates account arrays per credential. Routes gain an `extras` argument; the form gains add/remove rows; the results page parses/canonicalizes a `wallets` query param; the attest panel explains why aggregates can't be attested and links to the single-wallet score.

**Tech Stack:** Next.js 16 App Router, React 19, viem `isAddress`, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-multi-wallet-design.md`

## Global Constraints

- Never add a `webpack:` key to `next.config.ts`; leave `turbopack.ignoreIssue` untouched.
- No new dependencies, no secrets, no env vars.
- These files stay byte-identical: `src/lib/engine.ts`, `chains.ts`, `github.ts`, `github-auth.ts`, `github-auth-store.ts`, `speedrun.ts`, `easscan.ts`, `eas.ts`, `verify.ts`, `history.ts`, `ens.ts`.
- URL shapes live only in `src/lib/routes.ts`. Without extras, `scorePath`/`inputPath` outputs stay byte-identical to today's.
- Wallet cap: 5 total (primary + 4 extras). Dedup is case-insensitive and silent.
- If any wallet's source is unavailable, the merged credential is `unavailable` — "couldn't check" must never read as "not earned".
- All 137 existing tests stay green. Visual language: dark zinc + emerald, amber for warnings.
- Known transient: stale `.next/dev/types` typecheck errors while the dev server runs → `npm run build` once, retry. Never run `npm run dev`.
- Work happens on branch `feat/multi-wallet`.

---

### Task 1: Merge + multi-gather in orchestrate

**Files:**
- Modify: `src/lib/orchestrate.ts`
- Modify: `src/app/score/[wallet]/page.tsx:121` (one mechanical line — keeps typecheck green)
- Test: `test/orchestrate.test.ts` (extend), `test/engine.test.ts` (extend)

**Interfaces:**
- Produces (consumed by Tasks 4–5): `mergeCredentialInputs(a: CredentialInput, b: CredentialInput): CredentialInput`; `gatherMultiInputs(addresses: `0x${string}`[], githubHandle: string | null, fetchers?: Partial<Fetchers>, onSourceSettled?: (source: GatherSource) => void): Promise<GatherResult>`; `Scored` gains required `extraAddresses: `0x${string}`[]`.
- `gatherInputs` keeps its exact signature (becomes a wrapper); existing callers and tests unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/orchestrate.test.ts` (inside the file, after the existing `gatherInputs` describe; add `mergeCredentialInputs, gatherMultiInputs` to the existing `@/lib/orchestrate` import):

```ts
describe('mergeCredentialInputs', () => {
  it('concatenates accounts in order', () => {
    expect(mergeCredentialInputs(ok(1), ok(2))).toEqual({ status: 'ok', accounts: [1, 2] })
  })
  it('propagates unavailability from either side', () => {
    const bad: CredentialInput = { status: 'unavailable', reason: 'rpc down' }
    expect(mergeCredentialInputs(bad, ok(2))).toEqual(bad)
    expect(mergeCredentialInputs(ok(1), bad)).toEqual(bad)
  })
})

describe('gatherMultiInputs', () => {
  const A = '0x000000000000000000000000000000000000000a' as `0x${string}`
  const B = '0x000000000000000000000000000000000000000b' as `0x${string}`

  it('fans out per wallet, fetches GitHub once, merges accounts in wallet order', async () => {
    const chainCalls: string[] = []
    const githubCalls: (string | null)[] = []
    const { inputs, baseBlockNumber } = await gatherMultiInputs([A, B], 'octocat', {
      chains: async (address) => {
        chainCalls.push(address)
        return {
          values: { eth_global_hacker: ok(address === A ? 1 : 5), talent_vault: ok(2) },
          baseBlockNumber: address === A ? 111n : 222n,
        }
      },
      github: async (handle) => {
        githubCalls.push(handle)
        return { github_followers: ok(170) }
      },
      speedrun: async (address) => ok(address === A ? 3 : 4),
      verifiedBuilder: async () => ok(1),
    })
    expect([...chainCalls].sort()).toEqual([A, B])
    expect(githubCalls).toEqual(['octocat'])
    expect(inputs.values.eth_global_hacker).toEqual({ status: 'ok', accounts: [1, 5] })
    expect(inputs.values.talent_vault).toEqual({ status: 'ok', accounts: [2, 2] })
    expect(inputs.values.github_followers).toEqual(ok(170))
    expect(inputs.values.buidl_guidl_speedrun_ethereum).toEqual({ status: 'ok', accounts: [3, 4] })
    expect(inputs.values.talent_protocol_verified_builder).toEqual({ status: 'ok', accounts: [1, 1] })
    expect(baseBlockNumber).toBe(111n)
  })

  it('settles each source exactly once, after all wallets', async () => {
    const settled: string[] = []
    await gatherMultiInputs(
      [A, B],
      null,
      {
        chains: async () => ({ values: {}, baseBlockNumber: null }),
        github: async () => ({}),
        speedrun: async () => ok(0),
        verifiedBuilder: async () => ok(0),
      },
      (source) => settled.push(source),
    )
    expect(settled).toHaveLength(4)
    expect([...settled].sort()).toEqual(['chains', 'github', 'speedrun', 'verifiedBuilder'])
  })

  it('marks a credential unavailable when any wallet could not be checked', async () => {
    const { inputs } = await gatherMultiInputs([A, B], null, {
      chains: async (address) => ({
        values: {
          eth_global_hacker:
            address === B ? { status: 'unavailable' as const, reason: 'rpc down' } : ok(1),
        },
        baseBlockNumber: null,
      }),
      github: async () => ({}),
      speedrun: async () => ok(0),
      verifiedBuilder: async () => ok(0),
    })
    expect(inputs.values.eth_global_hacker).toEqual({ status: 'unavailable', reason: 'rpc down' })
  })

  it('rejects an empty address list', async () => {
    await expect(gatherMultiInputs([], null)).rejects.toThrow()
  })
})
```

Append to `test/engine.test.ts` (add any imports the file doesn't already have — `computeScore` and the `Spec` type):

```ts
describe('multi-account aggregation', () => {
  const miniSpec: Spec = {
    name: 'test',
    version: 'test',
    constants: { SECONDS_IN_A_YEAR: 31536000 },
    credentials: [
      { slug: 'sum_cred', name: 'Sum', tier: 'rpc', value: 'v', max_score: 100, multiplier: 1, conversion: 'no_conversion', calculation: 'sum_all', poc: true },
      { slug: 'max_cred', name: 'Max', tier: 'rpc', value: 'v', max_score: 100, multiplier: 1, conversion: 'no_conversion', calculation: 'max_value', poc: true },
    ],
  }
  it('sum_all sums accounts across wallets', () => {
    const result = computeScore(
      { computedAt: 1, values: { sum_cred: { status: 'ok', accounts: [2, 3] }, max_cred: { status: 'ok', accounts: [0] } } },
      miniSpec,
    )
    expect(result.perCredential.find((c) => c.slug === 'sum_cred')?.points).toBe(5)
    expect(result.perCredential.find((c) => c.slug === 'sum_cred')?.rawValue).toBe(5)
  })
  it('max_value takes the best account across wallets', () => {
    const result = computeScore(
      { computedAt: 1, values: { sum_cred: { status: 'ok', accounts: [0] }, max_cred: { status: 'ok', accounts: [7, 4] } } },
      miniSpec,
    )
    expect(result.perCredential.find((c) => c.slug === 'max_cred')?.points).toBe(7)
    expect(result.perCredential.find((c) => c.slug === 'max_cred')?.rawValue).toBe(7)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/orchestrate.test.ts test/engine.test.ts`
Expected: orchestrate FAILS (no `mergeCredentialInputs`/`gatherMultiInputs` export); the two new engine tests PASS immediately (the engine already implements this — they are regression armor, not TDD; note this in your report).

- [ ] **Step 3: Implement**

In `src/lib/orchestrate.ts`, add `extraAddresses` to `Scored`:

```ts
// A fully computed score bundle as the UI screens pass it around.
export interface Scored {
  score: ScoreResult
  gather: GatherResult
  address: `0x${string}`
  githubHandle: string | null
  extraAddresses: `0x${string}`[]
}
```

Replace the body of `gatherInputs` and add the new functions (keep imports/`defaultFetchers`/`GatherSource` as they are):

```ts
// Two per-wallet results for the same credential become one: accounts
// concatenate in wallet order; if either wallet couldn't be checked the
// merged credential stays unavailable ("couldn't check" ≠ "not earned").
export function mergeCredentialInputs(a: CredentialInput, b: CredentialInput): CredentialInput {
  if (a.status === 'unavailable') return a
  if (b.status === 'unavailable') return b
  return { status: 'ok', accounts: [...a.accounts, ...b.accounts] }
}

export async function gatherMultiInputs(
  addresses: `0x${string}`[],
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
  onSourceSettled?: (source: GatherSource) => void,
): Promise<GatherResult> {
  if (addresses.length === 0) throw new Error('gatherMultiInputs requires at least one address')
  const f = { ...defaultFetchers, ...fetchers }
  const computedAt = Math.floor(Date.now() / 1000)
  const pocRpcSlugs = new Set(
    spec.credentials.filter((c) => c.poc && c.tier === 'rpc').map((c) => c.slug),
  )

  const settle = <T,>(source: GatherSource, promise: Promise<T>): Promise<T> =>
    promise.finally(() => onSourceSettled?.(source))

  const [chainResults, github, speedruns, verifiedBuilders] = await Promise.all([
    settle('chains', Promise.all(addresses.map((a) => f.chains(a, pocRpcSlugs)))),
    settle('github', f.github(githubHandle)),
    settle('speedrun', Promise.all(addresses.map((a) => f.speedrun(a)))),
    settle('verifiedBuilder', Promise.all(addresses.map((a) => f.verifiedBuilder(a)))),
  ])

  const chainValues: Record<string, CredentialInput> = {}
  for (const result of chainResults) {
    for (const [slug, input] of Object.entries(result.values)) {
      chainValues[slug] =
        slug in chainValues ? mergeCredentialInputs(chainValues[slug], input) : input
    }
  }

  return {
    inputs: {
      computedAt,
      values: {
        ...chainValues,
        ...github,
        buidl_guidl_speedrun_ethereum: speedruns.reduce(mergeCredentialInputs),
        talent_protocol_verified_builder: verifiedBuilders.reduce(mergeCredentialInputs),
      },
    },
    // The as-of anchor stays the primary wallet's.
    baseBlockNumber: chainResults[0].baseBlockNumber,
  }
}

export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
  onSourceSettled?: (source: GatherSource) => void,
): Promise<GatherResult> {
  return gatherMultiInputs([address], githubHandle, fetchers, onSourceSettled)
}
```

In `src/app/score/[wallet]/page.tsx` line 121, make the one mechanical change so the required field typechecks (Task 4 replaces it properly):

```tsx
          scored: { score: computeScore(gather.inputs, spec), gather, address, githubHandle, extraAddresses: [] },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/orchestrate.test.ts test/engine.test.ts` → PASS (existing 3 orchestrate tests included).
Run: `npm test` → 145 tests. `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orchestrate.ts 'src/app/score/[wallet]/page.tsx' test/orchestrate.test.ts test/engine.test.ts
git commit -m "feat: multi-wallet input merging and gatherMultiInputs"
```

---

### Task 2: Routes carry extras

**Files:**
- Modify: `src/lib/routes.ts`
- Test: `test/routes.test.ts` (extend)

**Interfaces:**
- Produces (consumed by Tasks 3–5): `scorePath(wallet: string, github: string | null, extras: string[] = [])`; `inputPath(wallet: string | null = null, github: string | null = null, extras: string[] = [])`. Both trim extras and drop empty tokens; empty extras → today's output byte-identical.

- [ ] **Step 1: Write the failing tests**

Append to `test/routes.test.ts`:

```ts
describe('extra wallets', () => {
  it('scorePath without extras is unchanged', () => {
    expect(scorePath('0xabc', null)).toBe('/score/0xabc')
    expect(scorePath('0xabc', 'octocat', [])).toBe('/score/0xabc?github=octocat')
  })
  it('scorePath appends comma-separated wallets', () => {
    expect(scorePath('0xabc', null, ['0xdef', '0x123'])).toBe('/score/0xabc?wallets=0xdef,0x123')
    expect(scorePath('0xabc', 'octocat', ['0xdef'])).toBe(
      '/score/0xabc?github=octocat&wallets=0xdef',
    )
  })
  it('scorePath drops blank extras', () => {
    expect(scorePath('0xabc', null, [' ', ''])).toBe('/score/0xabc')
  })
  it('inputPath without extras is unchanged', () => {
    expect(inputPath()).toBe('/score')
    expect(inputPath('0xabc', 'octocat')).toBe('/score?wallet=0xabc&github=octocat')
  })
  it('inputPath carries extras', () => {
    expect(inputPath('0xabc', null, ['0xdef', '0x123'])).toBe(
      '/score?wallet=0xabc&wallets=0xdef%2C0x123',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/routes.test.ts`
Expected: FAIL — extras argument not accepted / wallets param missing.

- [ ] **Step 3: Implement**

Replace `scorePath` and `inputPath` in `src/lib/routes.ts` (leave `verifyPath` and the header comment untouched):

```ts
function cleanExtras(extras: string[]): string[] {
  return extras.map((e) => e.trim()).filter((e) => e !== '')
}

export function scorePath(wallet: string, github: string | null, extras: string[] = []): string {
  const parts: string[] = []
  const handle = github?.trim() ?? ''
  if (handle) parts.push(`github=${encodeURIComponent(handle)}`)
  const list = cleanExtras(extras)
  // Commas are legal raw in query values; keep the shareable URL readable.
  if (list.length > 0) parts.push(`wallets=${list.map(encodeURIComponent).join(',')}`)
  return parts.length > 0 ? `/score/${wallet}?${parts.join('&')}` : `/score/${wallet}`
}

export function inputPath(
  wallet: string | null = null,
  github: string | null = null,
  extras: string[] = [],
): string {
  const params = new URLSearchParams()
  const addr = wallet?.trim() ?? ''
  const handle = github?.trim() ?? ''
  if (addr) params.set('wallet', addr)
  if (handle) params.set('github', handle)
  const list = cleanExtras(extras)
  if (list.length > 0) params.set('wallets', list.join(','))
  const query = params.toString()
  return query ? `/score?${query}` : '/score'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/routes.test.ts` → PASS (15 tests).
Run: `npm test` → 150 tests. `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routes.ts test/routes.test.ts
git commit -m "feat: routes carry extra wallets"
```

---

### Task 3: Form gains extra wallet rows

**Files:**
- Modify: `src/app/score/page.tsx`

**Interfaces:**
- Consumes: Task 2's `scorePath(wallet, github, extras)`.

- [ ] **Step 1: Implement**

All edits inside `ScoreForm` in `src/app/score/page.tsx`.

Add state below the existing `githubInput` state (prefill from the `wallets` query param, cap 4):

```tsx
  const [extraInputs, setExtraInputs] = useState<string[]>(() => {
    const raw = searchParams.get('wallets') ?? ''
    return raw
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w !== '')
      .slice(0, 4)
  })
```

Replace the whole `handleSubmit` function with:

```tsx
  async function resolveWallet(
    input: string,
  ): Promise<{ address: string } | { error: string }> {
    if (isAddress(input)) return { address: input }
    if (looksLikeEnsName(input)) {
      const resolution = await resolveEnsName(input)
      if (resolution.status === 'resolved') return { address: resolution.address }
      if (resolution.status === 'unresolved')
        return { error: `“${input}” doesn’t resolve to an address.` }
      return { error: resolution.reason }
    }
    return { error: 'Enter an EVM address (0x…, 40 hex chars) or an ENS name.' }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const primary = addressInput.trim()
    const extras = extraInputs.map((w) => w.trim()).filter((w) => w !== '')
    setError(null)
    setResolving(true)
    const results = await Promise.all([primary, ...extras].map(resolveWallet))
    setResolving(false)
    const failedAt = results.findIndex((r) => 'error' in r)
    if (failedAt !== -1) {
      const prefix = failedAt === 0 ? '' : `Wallet ${failedAt + 1}: `
      setError(prefix + (results[failedAt] as { error: string }).error)
      return
    }
    const [primaryAddress, ...extraAddresses] = results.map(
      (r) => (r as { address: string }).address,
    )
    const seen = new Set([primaryAddress.toLowerCase()])
    const deduped = extraAddresses.filter((a) => {
      if (seen.has(a.toLowerCase())) return false
      seen.add(a.toLowerCase())
      return true
    })
    router.push(scorePath(primaryAddress, githubInput, deduped))
  }
```

In the JSX, directly after the closing `</div>` of the primary wallet field (before the GitHub handle `<div>`), insert:

```tsx
      {extraInputs.map((value, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <label htmlFor={`wallet-${i + 2}`} className="text-xs font-medium text-zinc-400">
            Wallet {i + 2}
          </label>
          <div className="flex gap-2">
            <input
              id={`wallet-${i + 2}`}
              value={value}
              onChange={(e) =>
                setExtraInputs((prev) => prev.map((w, j) => (j === i ? e.target.value : w)))
              }
              placeholder="0x… or name.eth"
              className="flex-1 rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
              spellCheck={false}
            />
            <button
              type="button"
              aria-label={`Remove wallet ${i + 2}`}
              onClick={() => setExtraInputs((prev) => prev.filter((_, j) => j !== i))}
              className="rounded-md border border-zinc-700 px-3 text-sm text-zinc-400"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {extraInputs.length < 4 && (
        <button
          type="button"
          onClick={() => setExtraInputs((prev) => [...prev, ''])}
          className="self-start text-xs text-zinc-400 underline"
        >
          + Add another wallet
        </button>
      )}
```

In the page `<header>`, replace the descriptive paragraph's text with:

```tsx
          Enter any wallet or ENS name — add up to 4 more to aggregate one score across them.
          Scoring runs entirely in your browser — connecting a wallet is only needed to attest.
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 150 tests. `npm run build` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/score/page.tsx
git commit -m "feat: multi-wallet rows on the score form"
```

---

### Task 4: Results page aggregates

**Files:**
- Modify: `src/app/score/[wallet]/page.tsx`

**Interfaces:**
- Consumes: `gatherMultiInputs` + `Scored.extraAddresses` (Task 1), `scorePath`/`inputPath` extras (Task 2).

- [ ] **Step 1: Implement**

All edits in `src/app/score/[wallet]/page.tsx`. Read the file in full first.

Change the import of `gatherInputs` to `gatherMultiInputs` (same module; keep `GatherSource`/`Scored`).

Widen `searchParams` and parse extras — replace the `const { github } = use(searchParams)` region:

```tsx
  searchParams: Promise<{ github?: string; wallets?: string }>
```

```tsx
  const { github, wallets } = use(searchParams)
```

and directly after the existing `githubHandle` line add:

```tsx
  const extrasRaw = (wallets ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .slice(0, 4)
  const tokens = [wallet, ...extrasRaw]
  const allAddresses = tokens.every((t) => isAddress(t))
  const allValid = tokens.every((t) => isAddress(t) || looksLikeEnsName(t))
```

Replace the lazy `useState<State>` initializer with:

```tsx
  const [state, setState] = useState<State>(() =>
    allAddresses
      ? { phase: 'loading', settled: [] }
      : allValid
        ? { phase: 'resolving' }
        : {
            phase: 'error',
            message: 'That doesn’t look like an EVM address (0x…, 40 hex chars) or ENS name.',
          },
  )
```

Replace the entire `useEffect` with:

```tsx
  useEffect(() => {
    let cancelled = false

    if (!allAddresses) {
      if (allValid) {
        // Shareable links may hold ENS names anywhere in the wallet list:
        // resolve them all, dedupe, then canonicalize the URL.
        setState({ phase: 'resolving' })
        ;(async () => {
          const resolved = await Promise.all(
            tokens.map(async (token) => ({
              token,
              result: isAddress(token)
                ? ({ status: 'resolved', address: token } as const)
                : await resolveEnsName(token),
            })),
          )
          if (cancelled) return
          const failed = resolved.find(({ result }) => result.status !== 'resolved')
          if (failed) {
            setState({
              phase: 'error',
              message:
                failed.result.status === 'unresolved'
                  ? `“${failed.token}” doesn’t resolve to an address.`
                  : (failed.result as { reason: string }).reason,
            })
            return
          }
          const [primary, ...rest] = resolved.map(
            ({ result }) => (result as { address: `0x${string}` }).address,
          )
          const seen = new Set([primary.toLowerCase()])
          const deduped = rest.filter((a) => {
            if (seen.has(a.toLowerCase())) return false
            seen.add(a.toLowerCase())
            return true
          })
          router.replace(scorePath(primary, githubHandle, deduped))
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

    const address = wallet as `0x${string}`
    const seen = new Set([address.toLowerCase()])
    const extraAddresses = (extrasRaw as `0x${string}`[]).filter((a) => {
      if (seen.has(a.toLowerCase())) return false
      seen.add(a.toLowerCase())
      return true
    })
    setState({ phase: 'loading', settled: [] })
    ;(async () => {
      try {
        // Signed-in sessions authenticate GitHub reads (5,000 req/hr vs 60).
        const fetchers = auth
          ? { github: (handle: string | null) => readGithubCredentials(handle, authorizedFetch(auth.token)) }
          : {}
        const gather = await gatherMultiInputs(
          [address, ...extraAddresses],
          githubHandle,
          fetchers,
          (source) => {
            if (cancelled) return
            setState((prev) =>
              prev.phase === 'loading'
                ? { phase: 'loading', settled: [...prev.settled, source] }
                : prev,
            )
          },
        )
        if (cancelled) return
        setState({
          phase: 'done',
          scored: {
            score: computeScore(gather.inputs, spec),
            gather,
            address,
            githubHandle,
            extraAddresses,
          },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, wallets, githubHandle, attempt, router, auth])
```

(`extrasRaw`/`tokens`/`allAddresses`/`allValid` are derived from `wallet` + `wallets`, which are in the deps — the eslint-disable line covers the derived bindings; keep it.)

Checklist row label — replace the `<li>` body inside the loading render:

```tsx
                {done ? '✓' : '○'}{' '}
                {source === 'chains' && extrasRaw.length > 0
                  ? `Onchain badges & balances (6 chains, ${extrasRaw.length + 1} wallets)`
                  : SOURCE_LABELS[source]}
```

Address block — replace the primary `<p className="break-all font-mono …">` with a fragment listing extras beneath:

```tsx
          <div className="flex flex-col gap-0.5">
            <p className="break-all font-mono text-xs text-zinc-500">
              {state.scored.address}
              {state.scored.githubHandle && ` · @${state.scored.githubHandle}`}
              {state.scored.githubHandle &&
                auth?.login.toLowerCase() === state.scored.githubHandle.toLowerCase() && (
                  <span className="text-emerald-400"> · verified</span>
                )}
            </p>
            {state.scored.extraAddresses.map((a) => (
              <p key={a} className="break-all font-mono text-xs text-zinc-500">
                + {a}
              </p>
            ))}
          </div>
```

Edit-inputs link — pass extras through:

```tsx
                href={inputPath(state.scored.address, state.scored.githubHandle, state.scored.extraAddresses)}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 150 tests. `npm run build` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/score/[wallet]/page.tsx'
git commit -m "feat: results page aggregates across wallets"
```

---

### Task 5: Attest panel multi-wallet note

**Files:**
- Modify: `src/components/attest-panel.tsx`

**Interfaces:**
- Consumes: `Scored.extraAddresses` (Task 1), `scorePath` (Task 2).

- [ ] **Step 1: Implement**

In `src/components/attest-panel.tsx`: extend the routes import to `import { scorePath, verifyPath } from '@/lib/routes'`. Then, directly AFTER the existing incomplete-data early return and BEFORE the unverified-handle gate, add:

```tsx
  // The onchain schema anchors exactly one wallet; attesting an aggregate
  // would make recompute-and-verify diverge by construction.
  if (scored.extraAddresses.length > 0) {
    return (
      <p className="text-xs text-zinc-500">
        This is an aggregate across {scored.extraAddresses.length + 1} wallets, and the
        attestation schema anchors exactly one wallet — so aggregate scores can&apos;t be
        attested.{' '}
        <Link
          href={scorePath(scored.address, scored.githubHandle)}
          className="text-emerald-400 underline"
        >
          Score the primary wallet alone
        </Link>{' '}
        to attest it.
      </p>
    )
  }
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 150 tests. `npm run build` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/attest-panel.tsx
git commit -m "feat: attest panel explains single-wallet-only attestation"
```

---

## Post-plan validation (coordinator, not a task)

Browser pass: form add/remove rows (cap at 5 total); submit two wallets (one ENS) → canonicalized URL `/score/0x…?wallets=0x…`; checklist shows "(6 chains, 2 wallets)"; aggregate score ≥ each single-wallet score for sum credentials; extras listed under the address; attest panel shows the aggregate note with a working single-wallet link; single-wallet URLs behave exactly as before; verify flow untouched. Then merge, redeploy to Vercel, re-smoke prod.
