# Open Builder Score

An open score anyone can compute: enter a wallet (+ optionally a GitHub handle) and get a
Builder Score computed **entirely in the browser** from public data — badges and token
holdings via RPC, GitHub via its public API — with an optional one-click EAS attestation
on Base. No backend, no database of people, no accounts.

**Live at [the-final-app-wine.vercel.app](https://the-final-app-wine.vercel.app)** (Base Sepolia attestations while in POC).

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
  meaningful is client-side (`"use client"`): no server state. The only server code is the
  pair of stateless GitHub device-flow passthroughs under `/api/github/*`, which exist
  solely because GitHub's device endpoints send no CORS headers. The engine stays
  framework-free (`src/lib/engine.ts`).
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

## Credential set — 15 credentials, 196 points (spec 0.2.0)

> The authoritative machine-readable versions live in `spec/spec.json` (weights + math)
> and `spec/badge-registry.json` (contract addresses, extracted from production).

Every credential carries a `status`: `active` (scored), `excluded` (computable, deliberately
not scored) or `deferred` (wanted, not computable yet). Multipliers are still the finalized
2025 season's; the *set* is narrower. `/credentials` renders all three, so what's left out
is as visible as what counts.

### Onchain — RPC reads

| slug | max | multiplier | conversion | calc | check |
|---|---|---|---|---|---|
| eth_global_hacker | 12 | 12.0 | none | max | Hacker Pack NFT (Optimism) |
| eth_global_builder | 20 | 20.0 | none | max | Builder Pack NFT (Optimism) |
| eth_global_pioneer | 10 | 10.0 | none | max | Pioneer Pack NFT (Optimism) |
| eth_global_partner | 12 | 12.0 | none | max | Partner Pack NFT (Optimism) |
| eth_global_finalist | 10 | 10.0 | none | max | 19 per-event finalist NFTs (Optimism) |
| devfolio_hackathons_participation | 20 | 10.0 | sqrt | max | distinct event SBTs (Base/Arb/Polygon) |
| base_devfolio_hackathons_participation | 20 | 10.0 | sqrt | max | 3 event SBTs (Base) |
| buidl_guidl_batches_graduate | 20 | 20.0 | none | max | 12 batch SBTs (OP + Arb) |
| talent_protocol_verified_builder | 20 | 20.0 | none | sum | EAS attestations (Base + Celo, via easscan GraphQL) |

Plus one public-API credential: `buidl_guidl_speedrun_ethereum` (12 / 1.0 / none / max) —
**not onchain**; it's BuidlGuidl's public API counting ACCEPTED challenges per wallet.

### Excluded — computable, deliberately not scored

A Builder Score should measure building. These score attendance, membership, a buyable
balance, or testnet activity, so they're carried in `spec.json` with `status: "excluded"`
and a reason rather than deleted — the contracts stay documented and the cut stays legible.

| slug | would-be max | why not |
|---|---|---|
| farcaster_farcon_nyc_2025_attendee | 12 | conference attendance is a ticket purchase |
| crypto_nomads_club | 12 | community membership, not building |
| developer_dao_member | 8 | a $CODE balance, buyable on the open market |
| talent_protocol_talent_holder | 8 | a $TALENT balance — buyable, and our own token |
| talent_vault | 8 | a $TALENT deposit — buyable, and our own token |
| base_learn | 13 | completion SBTs live on Base Sepolia; testnet is cheap to farm |

Dropping these took the ceiling from 257 to 196, and — because the scan's chain set is
derived from the active RPC slugs — retired two whole chains: Ethereum went with CNC and
$CODE, Base Sepolia with Base Learn. Four chains instead of six means fewer ways for a scan
to come back incomplete, which is what gates attestation.

### Deferred — needs token-metadata enumeration

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
mis-tiered as `rpc` in the original extraction; it needs token-id enumeration.

Also skipped: `developer_dao_og` (historical balance at block 13612670).

### GitHub (`tier: github_public`)

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
- [x] **3. Engine** — `src/lib/engine.ts`: pure `computeScore(inputs, spec) → {total, perCredential[]}`.
      ✅ No DOM, no fetch, no framework imports; Vitest golden vectors (131/196 across the
      15 active credentials).
- [x] **4. Chain reads** — `src/lib/chains.ts` ✅: one Multicall3 round-trip per chain across
      6 chains, public RPC fallback lists, cross-chain count merging, per-chain failure
      isolation ("couldn't check" ≠ "not earned").
- [x] **5. GitHub reads** — `src/lib/github.ts` ✅: the five metrics, paginated, graceful on
      404/rate-limit.
- [x] **6. UI** — ✅ form → total + credential cards (points, raw value, exact formula,
      earned / not-earned / couldn't-check states) + as-of anchor footer.
- [x] **7. Attest** — ✅ schema registered on **Base Sepolia** (schema
      [#2265](https://base-sepolia.easscan.org/schema/view/0x38b1a4ab5bee04789565591b11646eb0f5269096f65ef0b24e817f2b6168d1cd),
      UID `0x38b1a4ab5bee04789565591b11646eb0f5269096f65ef0b24e817f2b6168d1cd` — deterministic:
      `keccak256(schema ++ zero resolver ++ revocable)`, golden-pinned in `test/eas.test.ts`).
      Schema: `string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number`.
      E2E verified 2026-07-25 incl. the wrong-network switch path. Base mainnet registration
      deferred until after Sepolia validation (flip `ATTEST_CHAIN_ID` in `src/lib/eas.ts`).
- [x] **8. Deploy** — Vercel ✅ 2026-07-25: [the-final-app-wine.vercel.app](https://the-final-app-wine.vercel.app).
      No env vars, no secrets — the only server-side code is the two stateless GitHub
      device-flow passthrough routes (`/api/github/*`), which hold no state and pin the
      public client ID. Deployed via `vercel deploy --prod` from local `main`
      (no git integration yet — redeploys are manual).

## Badges

Zero-point achievements shown beside the score, defined in `spec/badges.json`. They add no
points, so they cannot move a total, change `ScoreResult.complete`, or alter what an
attestation says — and the verifier screen ignores them entirely, since a snapshot cannot be
re-derived at an as-of anchor.

| badge | source | how it's checked |
|---|---|---|
| $BUILD Contributor | live RPC **+** dated snapshot | `donated(address) > 0` on Base `0x556e…FdB7`, **or** a BUILD pay-it-forward donation |
| Launched a Talent Token | onchain history, frozen | membership in the v1 TalentFactory's `TalentCreated` history — Celo `0xa902…8246` + Polygon `0xa91b…fde0`, 564 wallets |
| Builder Score 100+ | dated snapshot | membership in an export from Talent Protocol |
| Earned Builder Rewards | dated snapshot | membership in an export from Talent Protocol |

A badge can carry more than one check, OR-ed: earned by any one is earned. `$BUILD
Contributor` uses two, because `DataPoints::BuildContribution` reads the BUILD airdrop
database *first* and only falls back to `donated()` — an allocation recorded there,
especially one on a custody wallet rather than the wallet a user would type in, is invisible
to the live read. That database is gone (`BUILD_DATABASE_URL` points at a Supabase project
that no longer resolves, matching `build_contribution` being marked Remove in the 2025
credential set), so the snapshot exports **`build_pay_forward_wallets`** instead — the
donors who gave their BUILD allocation away. Both sides of each pair ship, because the
donation sits on the custody wallet and custody wallets are not linked accounts, so that
table is the only place they come from.

Neither check subsumes the other: `donated()` records direct donations to the contract,
while pay-it-forward donations were recorded in the BUILD database. Sampling the export
against the contract, roughly a third of these wallets also show a non-zero `donated()` —
so the two overlap without either being complete.

The export also reads the stored `build_contribution` data point, but that population is
**empty**: the credential row was deleted when it was retired, and `Credential has_many
:data_points, dependent: :destroy` took the values with it. The query stays for the day it
comes back.

The snapshots are exported **profile-wide**: every EVM wallet on a qualifying profile, not
just the one the record sits on. A badge is a fact about a person, so whichever of their
wallets they enter should match.

**Why the Talent Token badge is not a live read.** The obvious call is
`talentsToTokens(wallet)` on the factory, and on Polygon it works. On Celo it does not: that
older deployment never populated the talent → token direction, so it returns `0x0` even for
wallets whose `createTalent` succeeded, and `hasTalentToken` reverts outright. Only
`tokensToTalents(token)` answers there, which cannot be asked from a wallet address. Polygon
holds 20 of the 564 talents, so a live read would have quietly missed the entire Celo
cohort. Both factories have been dormant since July 2023 and v1 is closed, so the set is
frozen and shipped as data — still public and reproducible, unlike the two snapshots below:

```sh
node scripts/build-talent-token-allowlist.mjs   # rebuilds spec/allowlists/talent-token-launched.json
```

The two snapshot badges have no permissionless source at all. Builder Score lives in Talent
Protocol's database, and rewards are paid from a per-grant wallet through a per-grant
multisend contract, so there is no stable distributor address to check. They ship as a dated
export, and the UI labels them as such.

Regenerating the snapshots, from the bastion:

```sh
cd ../talent-api/terraform
./obs_badge_export            # writes ../../open-builder-score/exports/*.txt
cd -
node scripts/build-snapshots.mjs
```

`obs_badge_export` streams the export back over ssh rather than writing a file on the
bastion and copying it: `dr` runs `docker run -it --rm` with no volume mounts, so anything
the script writes inside the container dies with it, and the image is the deployed build —
it won't contain `script/export_obs_badge_snapshots.rb` until that branch ships. Piping the
script in on stdin and capturing stdout sidesteps both. The same script also runs the
ordinary way anywhere with a filesystem worth writing to:

```sh
bundle exec rails runner script/export_obs_badge_snapshots.rb tmp/obs_badge_snapshots
cp ../talent-api/tmp/obs_badge_snapshots/*.txt exports/
```

That writes 256 shards per badge under `public/snapshots/<slug>/` — keyed by the first byte
of the address, so the client fetches one small file rather than a multi-MB list — and
updates `spec/snapshots.json` with the export date shown in the UI. Empty shards are written
too: the client reads a 404 as "couldn't check", so a missing shard has to mean a broken
deploy, never "not earned". Until the first export lands, `generated_at` is `null` and both
snapshot badges honestly render as unavailable.

## Resolved lookups

All three README-era unknowns were extracted from talent-api and live-verified (CORS open):

1. **SpeedRun Ethereum API** — `GET https://speedrunethereum.com/api/user-challenges/<address>`;
   count unique `challengeId` where `reviewAction == "ACCEPTED"`.
2. **TalentVault** — `userBalanceMeta(address)` returns `(depositedAmount, lastRewardCalculation,
   lastDepositAt)`; production uses index 0 ÷ 1e18.
3. **EAS GraphQL** — `https://base.easscan.org/graphql` + `https://celo.easscan.org/graphql`,
   query by checksummed recipient + schema UID, excluding revoked. (Production quirk: a Ruby
   `any?` short-circuit means prod effectively only queries Base; this POC follows the spec
   and queries both.)

## GitHub sign-in needs no secret

Recurring question, so: the OAuth **device flow** has no client secret and no redirect URI
by specification. There is nothing to configure locally and nothing to set in Vercel — the
client ID is a public identifier and ships committed, exactly like the WalletConnect
projectId. `NEXT_PUBLIC_GITHUB_CLIENT_ID` exists only to point the app at a different
GitHub app without a code change; leave it unset and sign-in works.

Signing in buys two things: it proves the GitHub handle going into a score is yours (the
attest panel enforces the match), and it lifts the GitHub API limit from 60 to 5,000
req/hr. The token is scope-less and lives in `sessionStorage`, so it dies with the tab.

## Ground rules

- The engine is deterministic: same inputs + same `spec.json` version → same score, always.
- `spec.json` is versioned; any weight/credential change bumps the version. Attestations
  carry the version they were computed with.
- Zero secrets in the repo, zero server-side state. If a feature needs a backend, it's out
  of scope for this repo (except, later, one stateless CORS/token worker for GitHub sign-in).
- **Wallet ownership is proved by the attestation, not by SIWE.** Anyone may score any
  address — that's the point of an open score — but attesting requires the connected wallet
  to *be* the scored wallet. EAS records the attester as `msg.sender`, so the transaction
  itself is the proof and anyone can check it afterwards by comparing `attester` to the
  attested `wallet` (`isSelfAttested` in `src/lib/verify.ts`, surfaced on the verify screen).
  A SIWE `personal_sign` would add a ceremony whose result only the signer's own browser
  could ever validate, which in an app with no backend proves nothing to a third party.
