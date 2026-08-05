# Credential Set Review: contribution analysis and the 0.3.0 re-cut (Review)

**Date:** 2026-08-05
**Status:** Review complete. P0 + P1 applied as spec 0.3.0 on `feat/badge-evidence-ledger`. P2 documented below as a 0.4.0 proposal, not applied.

## Goal

A credential-by-credential review of spec 0.2.0 (18 active credentials, 276
max points): what each one actually contributes, whether the curves and caps
do anything in the real population, what is cheapest to farm, and where the
set's own exclusion principles are applied inconsistently. Findings are
graded P0 (governance, fix regardless), P1 (low-risk fixes, applied in
0.3.0) and P2 (structural rebalance, proposed for 0.4.0).

Population data: `spec/nft-credentials.json` (chain-rebuilt allowlists),
`exports/*.csv` (talent-api export — covers only wallets attached to a
refreshed Talent profile, so its counts are floors, ~75–86% of the chain
rebuild). OBS scores from the chain rebuild, so scoring itself carries no
undercount; only calibration done from the CSVs does.

## 1. Contribution analysis (as reviewed, spec 0.2.0)

| credential | max | % of 276 | shape | cap binds at | population evidence |
|---|---|---|---|---|---|
| devfolio_hackathons_won | 30 | 10.9% | sqrt | 4 wins | binds for **1/515** wallets; 92.8% have n=1 |
| base_devfolio_hackathons_won | 30 | 10.9% | sqrt | 4 wins — **only 3 contracts exist** | best real wallet n=3; 90.1% have n=1 |
| eth_global_builder | 20 | 7.2% | binary | 1 NFT | — |
| devfolio_hackathons_participation | 20 | 7.2% | sqrt | 4 events | — |
| base_devfolio_hackathons_participation | 20 | 7.2% | sqrt | 4 events — **only 3 exist** | — |
| base_basecamp | 20 | 7.2% | binary | 1 SBT | 57/741 hold both SBTs for zero extra credit |
| buidl_guidl_batches_graduate | 20 | 7.2% | binary | 1 SBT (12 contracts) | — |
| talent_protocol_verified_builder | 20 | 7.2% | binary | 1 attester | — |
| eth_global_hacker | 12 | 4.3% | binary | 1 NFT | — |
| eth_global_partner | 12 | 4.3% | binary | 1 NFT | — |
| github_forks | 12 | 4.3% | sqrt | 34 forks | — |
| buidl_guidl_speedrun_ethereum | 12 | 4.3% | linear | 12 challenges | — |
| eth_global_pioneer | 10 | 3.6% | binary | 1 NFT | — |
| eth_global_finalist | 10 | 3.6% | binary | 1 NFT (19 contracts) | — |
| github_account_age | 8 | 2.9% | linear | 7.5 years | — |
| github_repositories | 8 | 2.9% | sqrt | 15 repos | — |
| github_followers | 6 | 2.2% | sqrt | 31 followers | — |
| github_stars | 6 | 2.2% | sqrt | 121 stars | — |

Theme concentration:

| theme | points | % of 276 |
|---|---|---|
| **All hackathons (EthGlobal + both Devfolio families)** | **164** | **59.4%** |
| Base ecosystem (base_devfolio 50 + basecamp 20) | 70 | 25.4% |
| EthGlobal | 64 | 23.2% |
| Devfolio (global) | 50 | 18.1% |
| GitHub | 40 | 14.5% |
| BuidlGuidl | 32 | 11.6% |
| Talent EAS | 20 | 7.2% |

Binary step functions: 8 of 18 credentials, 124/276 points (44.9%). And in
practice nearly everything else is a step function too — the winner
populations are 90–93% n=1, so the sqrt curves operate on <10% of holders
and the caps essentially never bind (once in 515 wallets). The score's real
texture is "which cliffs did you clear", not "how much did you do".

## 2. Issues

**I1 — Hackathon concentration (59.4%).** A prolific builder who never
enters hackathons hard-caps at 112/276 (40.6%). A single Devfolio win pays
25 points (won 15 + participation 10) — more than the entire GitHub group
can pay for years of open-source work (40).

**I2 — Base double-track.** Base-platform hackathons get their own 50-point
credential pair with independent caps; the design privileges one L2's
events at 25.4% of a nominally ecosystem-neutral score. Export overlap is
modest today (22 wallets in both won-sets), so this currently *splits* more
than it *stacks* — but the asymmetry is structural.

**I3 — Unattainable caps.** Only 3 Base Devfolio contracts exist and the
manifest is frozen. True maxima: participation round(10×√3) = 17 (cap said
20), won round(15×√3) = 26 (cap said 30). The real ceiling of spec 0.2.0
was 269, not the advertised 276.

**I4 — Farmability ranking** (cheapest first). GitHub + SpeedRun = 52
points (18.8%) reachable without real building:

| rank | credential | pts | cheapest path | est. cost |
|---|---|---|---|---|
| 1 | github_repositories | 8 | 15 empty public repos | ~10 min, $0 |
| 2 | github_forks | 12 | 34 forks from sock accounts (was sum_all) | hours, $0 |
| 3 | github_followers | 6 | 31 purchased followers | ~$5–10 |
| 4 | github_stars | 6 | 121 purchased stars | ~$10–25 |
| 5 | github_account_age | 8 | buy an aged account | ~$20–60 |
| 6 | speedrun | 12 | copy public challenge solutions | days, $0 |
| 7+ | eth_global packs, basecamp | 12–20 | attend/register an event | travel/gating |
| hardest | finalist, wons, batches, verified_builder | — | judged or gatekept | real work |

**I5 — Binary cliffs and a decorative sum.** One EAS attestation = 20
points. `verified_builder` was `sum_all` over `distinct_attesters` with
multiplier = max, so the sum could never matter — and in aggregate mode it
would happily re-count the same attester across wallets.

**I6 — sum_all/max_value inconsistency in GitHub.** Stars and followers
were `max_value`; forks and repositories `sum_all` — a carried-over
production artifact with no stated rationale, and an open door to
multi-account stacking the moment aggregate GitHub ships.

**I7 — The attendance line was drawn inconsistently.** FarCon is excluded
because "conference attendance is a ticket purchase, not building" — yet
`base_basecamp` is literally named "Basecamp Attendee" and pays 20 binary
points, and the defense (Basecamp admission is application-gated builder
selection) appeared nowhere in the spec.

**I8 — github_account_age measures time, not building.** Aged accounts are
purchasable; its one virtue is being the only anti-fresh-sybil prior.

**I9 — Undercount bias is confined.** talent-api's `wallet_nfts` covers
72,085 of 5.79M wallet accounts, but OBS scores indexed credentials from
the chain-rebuilt allowlists, so scores aren't biased — only the snapshot
badges (already labeled as dated exports) and CSV-based calibration are.

**I10 — Governance drift.** Commit `c8c8181` activated the three
NFT-metadata credentials (196 → 276 points) without bumping the spec
version, violating the repo's own ground rule. A 196-era attestation and a
276-era attestation both said `spec_version: "0.2.0"`, and `verify.ts`
keys on the version string alone — a correct 196-era attestation
re-verified against the 276-point spec reads as a *wrong score* instead of
`spec_mismatch`. Blast radius ≈ nil (Base Sepolia POC only), but the
mechanism was broken. The README had also drifted (15/196 header, the
activated three still listed as deferred).

**I11 — EthGlobal family-order inversion.** `eth_global_finalist` — the
only judged EthGlobal credential — was the joint-lowest in its family
(binary 10), below Hacker Pack (12, participation) and Builder Pack (20),
while the equivalent judged achievement on Devfolio paid 15×√n up to 30.
No documented rationale; the weights were inherited from production as-is.

## 3. Applied in 0.3.0 (P0 + P1)

Max total: 276 → **285**. Golden vector: 196 → 197.

| change | issue | real-wallet impact |
|---|---|---|
| Version bump + `changelog` field in spec.json | I10 | old Sepolia attestations now honestly report `spec_mismatch` |
| README rewritten to 18/285; activated three moved out of "Deferred" | I10 | none |
| win ⊃ participation stacking + Basecamp rationale documented as spec notes | I1, I7 | none |
| `eth_global_finalist`: binary 10 → 15×√(distinct finalist events), cap 30; registry method `nft_count` → `distinct_contracts_owned` | I11 | every finalist holder gains ≥5 pts (positive only) |
| `base_devfolio_hackathons_participation` cap 20 → 17 | I3 | none (unreachable range removed) |
| `base_devfolio_hackathons_won` cap 30 → 26 | I3 | none (best real wallet is n=3 = 26 exactly) |
| `github_repositories`: 2.0×√n cap 8 → 1.0×√n cap 4 | I4 | ≥4-repo profiles lose up to 4 pts |
| `github_forks`, `github_repositories`, `verified_builder`: sum_all → max_value | I5, I6 | none for single-handle scores; closes multi-account stacking |
| New guard test: every frozen-list sqrt credential must be able to reach its cap | I3 | permanent CI invariant |

Distinct-contracts semantics for the finalist re-cut is deliberate: one
step per finalist *event* (mirroring how Devfolio counts), so repeat
tokens from a single event cannot inflate the count.

## 4. Proposed for 0.4.0 (P2) — not applied

Target: shift weight from *showing up* to *being judged*, rather than
shrinking hackathons wholesale (they are the main peer-recognition venue
among available public sources).

| credential | proposal | effect at n=1 |
|---|---|---|
| eth_global_hacker | 12/12 → 8/8 | 12 → 8 |
| eth_global_partner | 12/12 → 8/8 | 12 → 8 |
| devfolio_hackathons_participation | mult 10 → 6, cap 20 → 12 | 10 → 6 |
| base_devfolio_hackathons_participation | mult 10 → 6, cap 17 → 10 | 10 → 6 (cap = round(6×√3), attainable) |
| base_basecamp | 20/20 → 12/12 | 20 → 12 |
| github_account_age | cap 8 → 4, mult 1.0 → 0.5 | halves the time-not-work reward, keeps the sybil prior |

Resulting total: 250 (from 285, −35). The *show-up* share (hacker +
partner + participations + basecamp) drops from 81 to 50 points while
judged/gated credentials (finalist, wons, builder, batches, verified) rise
proportionally. Typical deltas: single-win Devfolio wallet 25 → 21;
basecamp-only wallet 20 → 12; the GitHub group's ceiling 36 → 32.

**Prerequisite before applying:** recompute the export populations
(741/515/262 wallets plus synthetic GitHub profiles) under the candidate
weights and inspect the per-wallet delta distribution — the review's
population data says the sqrt curves barely operate, so the participation
trims are the only changes that touch a large fraction of wallets.

## 5. Explicitly not changing

- **The excluded six** — the reasons hold; the pin test makes re-admission
  a deliberate edit. Keep.
- **Encode (deferred)** — the only bulk metadata source returns 8,910 of
  14,432 tokens and contradicts its own holder count. The status_reason is
  exactly right. Keep deferred.
- **Engine semantics** (`engine.ts`, conversions, rounding, clamping) —
  attested-history verifiability depends on them. Rebalances move spec
  data only, never engine code.
- **Badge ↔ credential promotions** — none. `build_contributor` is a
  donation (buyable), `talent_token_launched` is a frozen 2023 cohort, the
  two snapshot badges have no permissionless source. All four correctly
  stay at zero points.
- **The won ⊃ participation stacking** — kept, now documented. Splitting
  it would double the allowlist machinery for no measurement gain.

## Verification

`npx vitest run`: 23 files, 330 tests green after the re-cut, including
the new attainability guard and the finalist-curve pins (n=1 → 15,
n=2 → 21, n=4 → 30). Independent recompute of the active max_score sum:
285. Docs sweep for `196|276|15 credentials`: clean.
