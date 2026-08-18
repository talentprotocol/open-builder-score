# Open Builder Score

An open score anyone can compute: enter a wallet (+ optionally a GitHub handle) and get a
Builder Score computed **entirely in the browser** from public data — badges and token
holdings via RPC, GitHub via its public API — with an optional one-click EAS attestation
on Base. No backend, no database of people, no accounts.

**Live at [the-final-app-wine.vercel.app](https://the-final-app-wine.vercel.app)** — attestations on **Base mainnet**
(registered 2026-08-18 via `scripts/register-schemas.mjs`; the POC ran on Base Sepolia, whose records this app no longer reads).

Context docs (internal):

- [What It Is (and Isn't)](https://app.notion.com/p/Open-Builder-Score-What-It-Is-and-Isn-t-3a771f7adb2081208e21f09a0aa8da8c) — concept, math, product shape
- [Credential Feasibility](https://app.notion.com/p/Open-Builder-Score-Credential-Feasibility-3a771f7adb20815c9669c9a72aef185a) — what's computable and what isn't

## What the POC must prove

1. A browser can compute a defensible score from public sources alone (no Talent infra).
2. The result is **explainable** — per-credential breakdown with the exact math shown.
3. The result is **attestable** — an EAS attestation that anyone can verify by recomputing.

Out of scope for the POC (deliberately): multi-wallet aggregation, GitHub sign-in
(OAuth), Tier 2 explorer-backed credentials, verifier view, embeddable
widget, percentile context.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind v4) — standard runtime, but everything
  meaningful is client-side (`"use client"`): no server state. The only server code is the
  three GitHub OAuth routes under `/api/github/*`, which exist because the token exchange
  needs a client secret the browser must never see. The engine stays framework-free
  (`src/lib/engine.ts`).
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

## Credential set — 18 credentials, 285 points (spec 0.3.0)

> The authoritative machine-readable versions live in `spec/spec.json` (weights + math)
> and `spec/badge-registry.json` (contract addresses, extracted from production).

Every credential carries a `status`: `active` (scored), `excluded` (computable, deliberately
not scored) or `deferred` (wanted, not computable yet). Multipliers started from the
finalized 2025 season's; deviations are deliberate and recorded in the spec's `changelog`
(0.3.0: finalist re-cut, attainable Base Devfolio caps, github_repositories halved,
sum_all retired from the active set). `/credentials` renders the scored set only. The
`excluded` and `deferred` ones keep their `status_reason` in `spec.json`, and the spec
tests still prove every credential is accounted for, but the page no longer argues either
case.

### Onchain — RPC reads

| slug | max | multiplier | conversion | calc | check |
|---|---|---|---|---|---|
| eth_global_hacker | 12 | 12.0 | none | max | Hacker Pack NFT (Optimism) |
| eth_global_builder | 20 | 20.0 | none | max | Builder Pack NFT (Optimism) |
| eth_global_pioneer | 10 | 10.0 | none | max | Pioneer Pack NFT (Optimism) |
| eth_global_partner | 12 | 12.0 | none | max | Partner Pack NFT (Optimism) |
| eth_global_finalist | 30 | 15.0 | sqrt | max | distinct finalist NFTs across 19 per-event contracts (Optimism) — the judged-results curve, mirrors devfolio_hackathons_won |
| devfolio_hackathons_participation | 20 | 10.0 | sqrt | max | distinct event SBTs (Base/Arb/Polygon) |
| base_devfolio_hackathons_participation | 17 | 10.0 | sqrt | max | 3 event SBTs (Base) — cap = round(10×√3), the frozen manifest's true maximum |
| buidl_guidl_batches_graduate | 20 | 20.0 | none | max | 12 batch SBTs (OP + Arb) |
| talent_protocol_verified_builder | 20 | 20.0 | none | max | EAS attestations (Base + Celo, via easscan GraphQL) |

Plus one public-API credential: `buidl_guidl_speedrun_ethereum` (12 / 1.0 / none / max) —
**not onchain**; it's BuidlGuidl's public API counting ACCEPTED challenges per wallet.

### Indexed — allowlist NFT credentials

Formerly deferred, activated once their allowlists could be rebuilt from chain data: scored
from those allowlists
(`public/nft-credentials/` shards, generated by `scripts/build-nft-credential-allowlists.mjs`),
because their checks need token-metadata enumeration a browser can't do. The "won" variants
use the *same contracts* as participation but filter token metadata (`nft_type == "WINNER"`)
— a win intentionally also earns participation (win ⊃ participate).

| slug | max | multiplier | conversion | calc | check |
|---|---|---|---|---|---|
| devfolio_hackathons_won | 30 | 15.0 | sqrt | max | WINNER tokens across the 11 participation contracts |
| base_devfolio_hackathons_won | 26 | 15.0 | sqrt | max | WINNER tokens, 3 Base contracts — cap = round(15×√3) |
| base_basecamp | 20 | 20.0 | none | max | 2 attendee SBTs (ERC-1155; application-gated builder program, which is why it survives the attendance exclusion below) |

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

The re-cut that dropped these — because the scan's chain set is derived from the active
RPC slugs — retired two whole chains: Ethereum went with CNC and $CODE, Base Sepolia with
Base Learn. Four chains instead of six means fewer ways for a scan to come back incomplete,
which is what gates attestation.

### Deferred — no validatable source

Encode uses one contract with programme-type attributes, but the only source that serves
the metadata in bulk truncates the collection (8,910 of 14,432 tokens) and contradicts its
own holder count, so no build of it can be validated:

| slug | max | multiplier | conversion | calc |
|---|---|---|---|---|
| encode_programmes_participations | 20 | 10.0 | sqrt | max |
| encode_programmes_won | 30 | 15.0 | sqrt | max |

Also skipped: `developer_dao_og` (historical balance at block 13612670).

### GitHub (`tier: github_public`)

| slug | max | multiplier | conversion | calc | source |
|---|---|---|---|---|---|
| github_account_age | 8 | 1.0 | timestamp_to_year | max | `GET /users/:handle` created_at |
| github_followers | 6 | 1.0 | sqrt | max | `GET /users/:handle` followers |
| github_stars | 6 | 0.5 | sqrt | max | sum `stargazers_count` over repos |
| github_forks | 12 | 2.0 | sqrt | max | sum `forks_count` over repos |
| github_repositories | 4 | 1.0 | sqrt | max | public repo count (approximation — production counts repos *contributed to*; note it in the UI). Halved in 0.3.0: empty repos are the cheapest farm in the set |

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
      ✅ No DOM, no fetch, no framework imports; Vitest golden vectors (197/285 across the
      18 active credentials).
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
      done 2026-08-18: `ATTEST_CHAIN_ID` is 8453 (Base mainnet); both schemas keep their
      Sepolia UIDs since a schema UID hashes only (schema, resolver, revocable).
- [x] **8. Deploy** — Vercel ✅ 2026-07-25: [the-final-app-wine.vercel.app](https://the-final-app-wine.vercel.app).
      The only server-side code is the three GitHub OAuth routes (`/api/github/*`), which
      hold no state; `GITHUB_CLIENT_SECRET` is set in the Vercel project, never committed. Deployed via `vercel deploy --prod` from local `main`
      (no git integration yet — redeploys are manual).
- [x] **9. Aggregate attestation** — a second EAS schema so a multi-wallet score can be
      attested, with an EIP-712 ownership signature per extra wallet stored in the record.
      Schema registered on **Base Sepolia** 2026-08-04 as schema
      [#2307](https://base-sepolia.easscan.org/schema/view/0x01d83b22aca3881b6673513b0e29fec6659a7def03c69fa41c55a16bcaf192a2),
      UID `0x01d83b22aca3881b6673513b0e29fec6659a7def03c69fa41c55a16bcaf192a2` — deterministic
      and golden-pinned in `test/eas.test.ts`, alongside the single-wallet schema
      [#2265](https://base-sepolia.easscan.org/schema/view/0x38b1a4ab5bee04789565591b11646eb0f5269096f65ef0b24e817f2b6168d1cd).
      Re-runnable via `node --env-file=.env scripts/register-aggregate-schema.mjs` (preflight;
      add `--send` to register). Still to do: end-to-end attest on a real multi-wallet score.
      See "Aggregate attestation" below.

## Canonical domain — a deployment prerequisite

`SITE_ORIGIN` in `src/lib/routes.ts` is hardcoded to `https://talentprotocol.com`, and that
origin is now **written onchain** in schema #2304's description, where it cannot be edited
(only superseded). It is deliberately not read from the environment: these URLs outlive the
deployment that minted them, and a `VERCEL_URL` would point at a preview that stops resolving.

**It does not resolve yet.** `talentprotocol.com` serves the main Talent app, whose root
`app/[id]/` dynamic segment catches `/verify` and `/score`, and whose `/api` clashes outright.
Until talent-apps rewrites those paths to this app (or this app gets a `basePath`), the link
in the schema description is dead. Fixing that is the last step to making the onchain pointer
genuinely useful.

## Aggregate attestation

Scoring across up to 5 wallets already worked; attesting the result did not, because the
single-wallet schema anchors one address and nothing proved the user owned wallets 2–5.
Without that proof anyone could borrow a whale's address into their aggregate.

Schema v2 (`ATTEST_AGGREGATE_SCHEMA`, Base Sepolia schema #2307) keeps every v1 field and adds
the wallet set with its proofs, plus a pointer back into this app:

```
string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges
```

**`verify_url` opens the verification view, not a fresh scoring run.** Someone reading an
attestation wants to see what was verified, not start a new computation — so it points at
`/verify/wallet/<recipient>`, which resolves to that wallet's most recent attestation and hands
off to the verify screen.

It is keyed on the wallet rather than on the attestation's own UID because **an attestation can
never contain a link to itself**, for two independent reasons, both confirmed by recomputing a
live attestation's UID from its fields: the UID hashes the record's own `data`, and it also
hashes `block.timestamp`, which isn't known until the transaction is mined. The URL is built by
the app's own router (`absoluteUrl(verifyWalletPath(…))`) so it cannot drift from real routing.

**`badges` records zero-point achievements, and the verifier says what each can rest on.**
Badges never affect the score. **Three of the four touch a dated Talent Protocol export**, so the
verify screen classifies rather than asserts — the attestation stores the slug but not which
check earned it:

| badge | evidence | shown as |
|---|---|---|
| Launched a Talent Token | `public` | re-derivable from public chain history |
| $BUILD Contributor | `mixed` | earned by a live onchain read **or** by a dated export — the record does not say which |
| Builder Score 100+ | `export` | rests on a dated Talent Protocol export — recorded, not independently checkable |
| Earned Builder Rewards | `export` | *(same)* |

Only `talent_token_launched` is fully permissionless: its allowlist is rebuilt from
`TalentCreated` events on Celo and Polygon, and anyone re-running
`scripts/build-talent-token-allowlist.mjs` gets the same list. `$BUILD Contributor` is an OR of
`donated(address) > 0` and the pay-it-forward export, so calling it public would overclaim for
anyone who earned it only through the export. `classifyAttestedBadges` in `src/lib/badges.ts`
draws these lines; an unknown slug stays visible and is classified at the cautious end.

Note easscan renders these as plain text, not links — it does not autolink attestation values.
Three earlier cuts were superseded: #2304 (no URL field, 0 attestations), #2305
(`verify_url_prefix`, 1 attestation) and #2306 (`score_url`, 1 attestation). Both #2305 and
#2306 stay decode-only in `verify.ts` so their attestations keep verifying — the same rule that
kept the single-wallet schema alive. A #2306 record surfaces `verifyUrl: null`, so the screen
never offers a link that recomputes instead of showing what was verified.

`wallet` stays the recipient — that keeps `recipient == wallet`, keeps `isSelfAttested`
unchanged, and leaves `ownership_proofs[i]` a clean 1:1 with `extra_wallets[i]`. The recipient
needs no proof; `msg.sender` is its proof. `extra_wallets` is stored in canonical (sorted,
deduped) order, so the onchain array *is* the array the verifier reconstructs against.

Each extra wallet signs this, once, on Base Sepolia:

```
domain  { name: 'Open Builder Score', version: '2', chainId: 84532, verifyingContract: <EAS> }
message WalletOwnership { statement, wallet, recipient, wallets[], issuedAt, expiresAt }
```

- **Only the signature is stored.** The payload is reconstructed at verify time from fields
  already in the attestation, which is why the domain must be deterministic — no origin.
- **`expiresAt` is derived** (`issuedAt + 24h`), so nothing extra is stored and nothing can
  be forged. Verification checks the attestation's `timeCreated` falls inside that window;
  `timeCreated` is recorded by EAS, and the attester cannot pick it.
- **No nonce is needed.** `recipient` and the whole wallet set are bound into the message, so a
  signature cannot be replayed into someone else's aggregate.
- Signatures are stored **verbatim, never unwrapped** — a smart account returns an ABI-encoded
  wrapper, and while counterfactual an ERC-6492 one, which is exactly what makes it verifiable.

What verification can honestly claim, spelled out on the verify screen:

| signer | check | strength |
|---|---|---|
| EOA | `recoverTypedDataAddress` | offline, permissionless, true forever |
| EIP-7702 delegated EOA signing with its key | `recoverTypedDataAddress` | same — recovery succeeds even though the account has code |
| smart account (or a 7702 account returning a wrapped signature) | ERC-1271 / ERC-6492 via RPC | depends on the account's **current** owners or delegation |

Worth knowing: both wallets that have used the single-wallet schema on Base Sepolia are **EIP-7702
delegated EOAs** (delegate `0x63c0c19a…`, ERC-1271 live), so the contract path is not hypothetical
here — and a 7702 delegation can be re-pointed or revoked, which is exactly the mutability the
ERC-1271 caveat is about.

ERC-1271 is a call to a contract whose owner set can change, so it answers "does this account
accept the signature *today*", not "did it at attest time". Public Base RPCs prune state, so
as-of-block verification needs an archive node; `verifyOwnershipProofs` takes an optional
`blockNumber` for anyone who has one, and defaults to latest. An RPC failure reports
`unchecked`, never `invalid` — the same "couldn't check ≠ not earned" rule the chain reads
follow.

Ownership is displayed as its own line and deliberately never reaches `classifyAttestation`
or `scoreVerdict`: score correctness and wallet ownership are independent facts. The
percentile corpus stays single-wallet only, since mixing 1-wallet and 5-wallet totals is not
like-for-like.

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

## GitHub sign-in

Standard OAuth web flow: click, authorize on github.com, land back signed in. One tab, two
clicks, nothing to type.

Signing in buys two things: it proves the GitHub handle going into a score is yours (the
attest panel enforces the match), and it lifts the GitHub API limit from 60 to 5,000 req/hr.
The token is scope-less and lives in `sessionStorage`, so it dies with the tab.

**This is the one place the repo needs a secret.** GitHub does not support PKCE, so
exchanging the callback code for a token requires `GITHUB_CLIENT_SECRET`. It is read only in
`src/lib/github-oauth.ts`, which is server-only — it never enters the client bundle, and it
is never committed. Scoring is unaffected either way: it is fully client-side and works
signed-out, so a deployment without the secret just reports that sign-in isn't configured.

| variable | where | required |
|---|---|---|
| `GITHUB_CLIENT_SECRET` | server only — `.env.local`, and Vercel project settings | for sign-in |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | optional override; the committed default is a public identifier | no |

Setup, once per environment:

1. In the GitHub app's settings, add a **Callback URL** for each origin —
   `http://localhost:3000/api/github/callback` and the deployed equivalent. GitHub
   validates `redirect_uri` against this list, so an unregistered origin simply fails.
2. Generate a client secret and put it in `.env.local` (git-ignored) and in Vercel.
3. Nothing else — no scopes are requested, and no installation is required.

The flow is three small routes and no server-side state: `/api/github/authorize` mints a
CSRF `state` and redirects to GitHub; `/api/github/callback` verifies that `state`, does the
secret-bearing exchange, and parks `{token, login}` in a short-lived `HttpOnly` cookie;
`/api/github/session` hands that to the client once and clears it, so the token's resting
place stays `sessionStorage`.

This replaced an OAuth **device flow**, which needed no secret but asked the user to copy a
code into a second tab — a TV/CLI affordance, not a web one. The secret is the price of the
better flow; GitHub offers no secretless redirect.

## Data-transfer opt-out (temporary)

One exception to "no backend, no database of people, zero server-side state" above: while
Talent Protocol winds down, three routes under `/api/opt-out/*` implement the data-transfer
opt-out flow. They read/write a dedicated Supabase database (records export + opt-out table)
and send one confirmation email via SendGrid; nothing else is stored server-side. See
`src/lib/supabase-admin.ts`, `src/lib/sendgrid.ts`, and the `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
/ `SENDGRID_API_KEY` entries in `.env.example`.

## Ground rules

- The engine is deterministic: same inputs + same `spec.json` version → same score, always.
- `spec.json` is versioned; any weight/credential change bumps the version. Attestations
  carry the version they were computed with.
- Zero secrets **in the repo**. `GITHUB_CLIENT_SECRET` is a server-only environment variable
  read only by server code — GitHub has no PKCE, so a redirect sign-in cannot be done without
  one — and everything that computes a score still runs in the browser against public
  endpoints with no keys. The temporary data-transfer opt-out flow (see above) is the
  exception to "zero server-side state": `SUPABASE_SECRET_KEY` and `SENDGRID_API_KEY` are two
  more server-only secrets, and the opt-out records described above are real server-side
  state — the app stores nothing else server-side.
- **Wallet ownership is proved by the attestation.** Anyone may score any address — that's
  the point of an open score — but attesting requires the connected wallet to *be* the scored
  wallet. EAS records the attester as `msg.sender`, so the transaction itself is the proof
  and anyone can check it afterwards by comparing `attester` to the attested `wallet`
  (`isSelfAttested` in `src/lib/verify.ts`, surfaced on the verify screen).

  Attesting an aggregate requires every wallet in the set to be proven: the wallet that sends
  the transaction is proven by `msg.sender` — EAS records it as the attester — and each of the
  others by an EIP-712 signature stored inside the attestation. Any wallet of the set may be
  the sender. The first wallet is simply the address the score is issued to (the EAS recipient,
  where lookups find it); it has no signing privilege. That is the whole difference from SIWE:
  the objection to a browser `personal_sign` was never the signature, it was that the result
  never left the browser. A signature written onchain is checkable by anyone, forever, with no
  server — and for EOAs, with no network call at all. SIWE itself is still the wrong format
  here: its `domain` and `uri` are origin-bound, so a message couldn't
  be reconstructed at verify time across localhost, previews, and production without storing
  the origin too.
