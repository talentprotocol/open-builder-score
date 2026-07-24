# the-final-app — Open Builder Score (POC)

A self-scoring page: anyone enters a wallet (+ optionally a GitHub handle) and gets a
Builder Score computed **entirely in the browser** from public data — badges and token
holdings via RPC, GitHub via its public API — with an optional one-click EAS attestation
on Base. No backend, no database of people, no accounts.

Context docs (internal):

- [What It Is (and Isn't)](https://app.notion.com/p/Open-Builder-Score-What-It-Is-and-Isn-t-3a771f7adb2081208e21f09a0aa8da8c) — concept, math, product shape
- [Credential Feasibility](https://app.notion.com/p/Open-Builder-Score-Credential-Feasibility-3a771f7adb20815c9669c9a72aef185a) — what's computable and what isn't

## What the POC must prove

1. A browser can compute a defensible score from public sources alone (no Talent infra).
2. The result is **explainable** — per-credential breakdown with the exact math shown.
3. The result is **attestable** — an EAS attestation that anyone can verify by recomputing.

Out of scope for the POC (deliberately): multi-wallet aggregation, GitHub sign-in
(device flow + worker), Tier 2 explorer-backed credentials, verifier view, embeddable
widget, percentile context.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4) — standard runtime, but everything
  meaningful is client-side (`"use client"`): no API routes, no server state. The
  engine stays framework-free (`src/lib/engine.ts`).
- [viem](https://viem.sh) for RPC, with Multicall3 batching
  (`0xcA11bde05977b3631167028862bE2a173976CA11`, same address on every chain)
- RainbowKit + wagmi for wallet connection — needed only for the attest step; scoring
  never requires a connected wallet. wagmi is pinned to 2.x (RainbowKit peer dep).
- `@ethereum-attestation-service/eas-sdk` for attestation
- Vitest for the engine's golden tests
- Public RPC endpoints with a fallback list (no API keys anywhere in the repo; the
  WalletConnect projectId is a public client identifier, not a secret)
- Full rationale: `docs/superpowers/specs/2026-07-24-open-builder-score-stack-design.md`

## The math (mirrors production exactly)

Per credential:

```
points = min(round(convert(value) * multiplier), max_score)
```

- `sum_all` credentials: **sum raw values across accounts first**, then convert, then multiply.
  (Single wallet in the POC makes this trivial, but implement the order correctly.)
- `max_value` credentials: convert × multiply per account, take the best.
- Conversions:
  - `no_conversion` — identity
  - `sqrt` — square root
  - `log` — **natural log** (ln)
  - `timestamp_to_year` — `(now - timestamp) / SECONDS_IN_A_YEAR`, rounded to 2 decimals,
    with `SECONDS_IN_A_YEAR = 31_536_000` (365 days — production constant, pin it in spec.json)
- **Total score = Σ credential points.** For determinism, "now" and balances are taken at an
  as-of anchor (timestamp + block number) that also goes into the attestation.

## POC credential set (weights = finalized 2025 season)

> The authoritative machine-readable versions live in `spec/spec.json` (weights + math)
> and `spec/badge-registry.json` (contract addresses, extracted from production).

### Tier 1 — RPC reads (in the POC)

| slug | max | multiplier | conversion | calc | check |
|---|---|---|---|---|---|
| eth_global_hacker | 12 | 12.0 | none | max | Hacker Pack NFT (Optimism) |
| eth_global_builder | 20 | 20.0 | none | max | Builder Pack NFT (Optimism) |
| eth_global_pioneer | 10 | 10.0 | none | max | Pioneer Pack NFT (Optimism) |
| eth_global_partner | 12 | 12.0 | none | max | Partner Pack NFT (Optimism) |
| eth_global_finalist | 10 | 10.0 | none | max | 19 per-event finalist NFTs (Optimism) |
| devfolio_hackathons_participation | 20 | 10.0 | sqrt | max | distinct event SBTs (Base/Arb/Polygon) |
| base_devfolio_hackathons_participation | 20 | 10.0 | sqrt | max | 3 event SBTs (Base) |
| base_learn | 13 | 1.0 | none | max | 13 completion SBTs (**Base Sepolia**) |
| buidl_guidl_batches_graduate | 20 | 20.0 | none | max | 12 batch SBTs (OP + Arb) |
| farcaster_farcon_nyc_2025_attendee | 12 | 12.0 | none | max | ticket NFT (Base) |
| crypto_nomads_club | 12 | 12.0 | none | max | membership SBT (Ethereum) |
| developer_dao_member | 8 | 0.02 | none | max | $CODE balance (Ethereum) |
| talent_protocol_talent_holder | 8 | 0.03 | sqrt | sum | $TALENT balance (Base) |
| talent_vault | 8 | 0.03 | sqrt | sum | `userBalanceMeta()` on vault (Base) |
| talent_protocol_verified_builder | 20 | 20.0 | none | sum | EAS attestations (Base + Celo, via easscan GraphQL) |

Plus one public-API credential in the POC: `buidl_guidl_speedrun_ethereum`
(12 / 1.0 / none / max) — **not onchain**; it's BuidlGuidl's public API counting
ACCEPTED challenges per wallet (verify CORS; defer if hostile).

### Deferred — needs token-metadata enumeration (post-POC)

The "won" variants use the *same contracts* as participation but filter token metadata
(`nft_type == "WINNER"`); Encode uses one contract with programme-type attributes:

| slug | max | multiplier | conversion | calc |
|---|---|---|---|---|
| devfolio_hackathons_won | 30 | 15.0 | sqrt | max |
| base_devfolio_hackathons_won | 30 | 15.0 | sqrt | max |
| encode_programmes_participations | 20 | 10.0 | sqrt | max |
| encode_programmes_won | 30 | 15.0 | sqrt | max |
| base_basecamp | 20 | 20.0 | none | max |

`base_basecamp`'s two attendee SBTs are ERC-1155, and production reads them from its NFT
indexer (`WalletNFT`/`TrackedNFT`), not RPC `balanceOf` (which reverts for 1155s) — it was
mis-tiered as `rpc` in the original extraction; it needs token-id enumeration post-POC.

Also skipped: `developer_dao_og` (historical balance at block 13612670).

### Tier 3 — GitHub, unauthenticated (`kind: github`)

| slug | max | multiplier | conversion | calc | source |
|---|---|---|---|---|---|
| github_account_age | 8 | 1.0 | timestamp_to_year | max | `GET /users/:handle` created_at |
| github_followers | 6 | 1.0 | sqrt | max | `GET /users/:handle` followers |
| github_stars | 6 | 0.5 | sqrt | max | sum `stargazers_count` over repos |
| github_forks | 12 | 2.0 | sqrt | sum | sum `forks_count` over repos |
| github_repositories | 8 | 2.0 | sqrt | sum | public repo count (approximation — production counts repos *contributed to*; note it in the UI) |

Unauthenticated limit is 60 req/hr per IP: 1 user call + paginated repos (100/page) is
fine for self-checks. Handle 403 rate-limit responses with a friendly message.

## Build phases

- [x] **1a. Spec data** — `spec/spec.json` (credentials, weights, math, tiers) ✅ generated
      from the production scorer dump.
- [x] **2. Badge registry** — `spec/badge-registry.json` ✅ generated from production
      `TrackedNFT` + the `app/services/data_points/*` contract maps.
- [x] **1b. Scaffold** — Next.js 16 app via `create-next-app` ✅ (spec files get
      imported as JSON modules in phase 3).
- [ ] **3. Engine** — `src/engine.ts`: pure `computeScore(inputs, spec) → {total, perCredential[]}`.
      No DOM, no fetch — takes already-fetched raw values. Vitest with a golden test vector.
- [ ] **4. Chain reads** — `src/chains.ts`: group registry entries by chain, one Multicall3
      round-trip per chain (`balanceOf` / `balanceOf(id)` for 1155s), public RPCs with fallback.
- [ ] **5. GitHub reads** — `src/github.ts`: the five metrics above, graceful on rate limits.
- [ ] **6. UI** — input form → total score + credential cards (points, raw value, formula
      applied, "not earned" state). The breakdown is the product.
- [ ] **7. Attest** — define schema, register on **Base Sepolia** first, then Base mainnet;
      "Attest onchain" button (user signs, user pays).
      Proposed schema:
      `string spec_version, address wallet, string github_handle, uint16 score, uint64 computed_at, uint64 block_number`
      EAS on Base is the OP-stack predeploy — verify addresses when registering
      (EAS `0x4200...0021`, SchemaRegistry `0x4200...0020`).
- [ ] **8. Deploy** — Vercel. No env vars, no secrets.

## Remaining lookups (small)

The production export and codebase extraction are done — `spec/badge-registry.json` holds
every contract address. What's left:

1. **BuidlGuidl API base URL** — see `lib/buidl_guidl/client.rb` in talent-api; verify the
   endpoint allows CORS from a browser.
2. **TalentVault ABI fragment** — `userBalanceMeta(address)` return shape, from
   `lib/abi/TalentVault.json` in talent-api (only the one function is needed).
3. **EAS GraphQL endpoints** — `https://base.easscan.org/graphql` (+ Celo instance) for the
   Verified Builder attestation lookup; confirm CORS.

## Ground rules

- The engine is deterministic: same inputs + same `spec.json` version → same score, always.
- `spec.json` is versioned; any weight/credential change bumps the version. Attestations
  carry the version they were computed with.
- Zero secrets in the repo, zero server-side state. If a feature needs a backend, it's out
  of scope for this repo (except, later, one stateless CORS/token worker for GitHub sign-in).
