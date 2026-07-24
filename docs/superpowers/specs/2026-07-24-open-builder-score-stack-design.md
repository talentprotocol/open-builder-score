# Open Builder Score POC — Stack & Scaffold Design

Date: 2026-07-24
Status: approved pending user review

## Goal

Stand up the web app that proves the README's three claims: a browser-computed,
explainable, attestable Builder Score from public data only. This spec covers the
stack, scaffolding approach, and project structure — the app phases themselves
(engine, chain reads, GitHub reads, UI, attest) are specified by the README and
`spec/spec.json` / `spec/badge-registry.json`, and will get their own
implementation plan.

## Decisions

The app starts as the POC but is expected to become the full product, so the
framework choice favors room to grow over minimal footprint.

| Concern | Choice | Version (latest as of 2026-07-24) |
|---|---|---|
| Framework | Next.js, App Router, standard runtime | 16.2.11 |
| Language | TypeScript (strict) | scaffold default |
| UI | React | 19.x (scaffold default) |
| Styling | Tailwind CSS | v4 (scaffold default) |
| Chain reads | viem, Multicall3 batching, `fallback()` public RPC transports | 2.55.8 |
| Wallet | RainbowKit + wagmi + TanStack Query | RainbowKit 2.2.11, **wagmi pinned to 2.19.5** (see below), react-query 5.101.4 |
| Attestation | `@ethereum-attestation-service/eas-sdk` | 2.9.1 |
| Engine tests | Vitest, golden test vectors | 4.1.10 |
| Package manager | npm | — |
| Deploy | Vercel, zero env vars, zero secrets | — |

### Version compatibility notes

- **wagmi must be installed as `wagmi@2` (2.19.5), not latest.** wagmi's current
  major is 3.x, but RainbowKit 2.2.11 declares a `wagmi: ^2.9.0` peer dependency.
  Installing wagmi 3 alongside RainbowKit breaks peer resolution. Upgrade both
  together when RainbowKit ships wagmi-3 support.
- eas-sdk brings ethers v6 as a transitive dependency alongside viem. Accepted for
  the POC; revisit only if bundle size becomes a real problem.

### Scaffolding

Generated with the official generator, not by hand:

```
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

`create-next-app` refuses to run in a directory containing `README.md` or
`spec/` (they're not on its allowed-files list). Scaffold procedure: generate
into a temporary subfolder, delete the generated README (ours wins), move
everything else up to the repo root, remove the emptied subfolder, and fix the
`name` in package.json.

### Client/server posture

Everything meaningful is client-side (`"use client"`): scoring, RPC reads,
GitHub fetches, wallet interaction, attestation. No API routes, no server
actions, no env vars in the POC. The server only renders the page shell. Server
capabilities remain available for the full product (GitHub sign-in worker, OG
images, percentiles) without a migration.

### Wallet / RainbowKit specifics

- RainbowKit's `getDefaultConfig` requires a WalletConnect (Reown) Cloud
  `projectId`. This is a **public client identifier** — it ships in the browser
  bundle by design and is not a secret, so hardcoding it in the repo does not
  violate the "zero secrets" ground rule. Create a free project, hardcode the id,
  and comment it as public-by-design.
- The wallet is needed only for the attest step. Score computation takes a typed
  address — no connection required, and the UI must not gate scoring behind
  connect.
- wagmi's config lives in a client provider component wrapping the page
  (`WagmiProvider` + `QueryClientProvider` + `RainbowKitProvider`), with
  `ssr: true` in the wagmi config so hydration is safe under the standard runtime.

## Project structure

```
src/app/                 App Router; layout.tsx hosts providers; page.tsx = the
                         self-scoring page ("use client")
src/app/providers.tsx    Wagmi + RainbowKit + React Query providers
src/lib/engine.ts        pure computeScore(inputs, spec) → {total, perCredential[]}
src/lib/chains.ts        registry grouped by chain, one Multicall3 round-trip per
                         chain, as-of anchor (block number + timestamp per chain)
src/lib/github.ts        the five unauthenticated GitHub metrics
src/lib/eas.ts           schema encoding + attest on Base (Sepolia first)
src/lib/types.ts         types for spec.json / badge-registry.json
spec/                    spec.json + badge-registry.json — imported as JSON
                         modules so they version with the bundle
test/engine.test.ts      golden test vectors
```

### The engine boundary (critical)

`src/lib/engine.ts` imports nothing from React, Next, viem, wagmi, or fetch. It
takes already-fetched raw values, the parsed spec, and the as-of anchor
timestamp, and returns numbers. This keeps the "anyone can recompute" claim
concrete: the engine is extractable as a standalone module, and Vitest tests it
with zero mocking.

## Data flow

1. Form: wallet address (required) + GitHub handle (optional).
2. In parallel: `chains.ts` runs one Multicall3 batch per chain, recording each
   chain's block number; `github.ts` fetches the five metrics.
3. Raw values + anchor → `engine.computeScore` → total + per-credential
   breakdown.

**As-of anchor, precisely:** one `computed_at` timestamp is captured when the
compute starts and is the single "now" for every `timestamp_to_year` conversion.
Each chain's block number at read time is recorded for reproducibility, but the
attestation carries `computed_at` plus **Base's** block number only — matching
the README's proposed schema (`uint64 computed_at, uint64 block_number`).
4. UI renders total plus one card per credential: points, raw value, the exact
   formula applied, and earned / not-earned / couldn't-check state. The breakdown
   is the product.
5. Optional "Attest onchain": RainbowKit connect → EAS attestation on Base (user
   signs, user pays), embedding spec version, score, and anchor.

## Error handling

- Each chain uses a viem `fallback()` transport over a list of public RPCs. If
  every RPC for a chain fails, that chain's credentials render as
  **"couldn't check"** — visually distinct from "not earned" — and attestation is
  disabled while any source is in that state (an attested score must be computed
  from complete data).
- GitHub 403 rate-limit → friendly message per the README; GitHub credentials
  become "couldn't check".
- Attest-flow errors (wrong network, user rejection, insufficient gas) surface
  inline at the button, not as toasts.

## Testing

- Vitest golden vectors for the engine: hand-computed expected outputs for a
  synthetic input set covering every conversion (`no_conversion`, `sqrt`, `log`,
  `timestamp_to_year`), both calculation modes (`sum_all` order of operations vs
  `max_value`), max_score clamping, and rounding.
- Chain/GitHub/EAS modules are thin I/O wrappers; correctness lives in the engine
  and the registry data. No E2E in the POC.

## README updates required

As part of scaffolding, update the README to match these decisions: Stack section
(Vite → Next.js 16 / RainbowKit / Vercel) and phase 8's deploy target
(Cloudflare/GitHub Pages → Vercel). Phase 1b's wording ("Vite app wired to load
both spec files") becomes the Next.js equivalent.

## Out of scope (unchanged from README)

Multi-wallet aggregation, GitHub sign-in, Tier 2 explorer-backed credentials,
verifier view, embeddable widget, percentile context, the deferred
token-metadata credentials, `developer_dao_og`.
