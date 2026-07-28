# Credentials Reference Page — Design Spec

**Date:** 2026-07-28
**Status:** Approved (pending spec review)
**Goal:** A public, shareable reference page listing every active credential and its exact scoring math — making "Open spec, open math" true for visitors without computing a score, and giving each credential a stable deep link for community discussion.

## Decisions (locked)

1. **Reference page only.** No propose-change affordance, no public repo/spec home in v1 (the GitHub repo is private; where the spec's public home lives is a separate governance decision). Community iteration happens by sharing links.
2. **Active credentials only.** The 20 `poc: true` credentials that produce the 257-point total. Deferred (`poc: false`) credentials do not appear.
3. **Shape A:** one `/credentials` route, grouped by data source, with `#slug` anchors per credential. No per-credential routes, no dense table.

## 1. Data helper — `src/lib/credential-reference.ts`

Pure module, derives everything from `spec/spec.json` (the same file the engine consumes — the reference can never drift from actual scoring). Exports:

- `groupCredentials(spec: Spec): CredentialGroup[]` — filters `poc === true`, groups in the scan panel's source order with the scan panel's vocabulary:
  1. **Onchain badges & balances** — everything not matched below (rpc + indexed tiers)
  2. **GitHub** — `tier === 'github_public'`
  3. **SpeedRun Ethereum** — slug `buidl_guidl_speedrun_ethereum`
  4. **EAS attestations** — slug `talent_protocol_verified_builder`

  Group order mirrors the scan checklist exactly: Onchain, GitHub, SpeedRun, EAS. Each group: `{ key, label, credentials, maxTotal }`.
- `formatFormula(credential): string` — the general (non-instantiated) formula using the engine's exact textual conventions, e.g. `min(round(value × 12), 12)`, `min(round(sqrt(value) × 10), 20)`, `min(round(years_since(value) × 1), 8)` for `timestamp_to_year`. Implementation must read `src/lib/engine.ts`'s instantiated-formula strings first and match their function-name spellings exactly (whatever engine.ts calls sqrt/log/timestamp conversion, the reference uses the same words with `value` in place of the number). Unknown conversion → throw (build-time data, fail fast).
- `describeValue(credential): string` — human phrase per spec `value` field: `nft_count` → "badges held", `distinct_contracts_owned` → "distinct qualifying contracts held", `erc20_balance_whole_tokens` → "token balance (whole tokens)", `contract_call` → "vault balance", `distinct_attesters` → "distinct attesters", `created_at_unix_timestamp` → "account creation date", `followers_count` → "followers", `sum_stargazers_over_owned_repos` → "stars across owned repos", `sum_forks_over_owned_repos` → "forks across owned repos", `public_repo_count` → "public repositories", `accepted_challenge_count` → "accepted challenges". Unknown → throw.
- `describeCalculation(credential): string | null` — multi-wallet aggregation label: `sum_all` → "summed across wallets", `max_value` → "best wallet counts".
- `displayNote(credential): string | null` — curated notes only (raw spec notes are dev-facing and stay out of the UI):
  - `github_repositories`: "Approximates production: public repo count vs. repos contributed-to."
  - `base_learn`: "Badges live on Base Sepolia (testnet)."
  - Everything else: `null`.

## 2. Page — `src/app/credentials/page.tsx`

Static server component (no client hooks; motion via existing shared components only).

- **Metadata:** title "Builder Score credentials — Open Builder Score"; description "Every credential in the open Builder Score: what it measures, the exact formula, and the points it can earn — 257 max."
- **Header:** Cal Sans h1 ("Credentials", `font-heading text-xl font-normal` — the subpage h1 idiom), subtitle in `text-base text-muted-foreground`: "Every point in a Builder Score comes from one of these 20 credentials — 257 max points, same inputs, same score, for anyone." The 20 and 257 are computed from the helper, not hardcoded (drift guard in copy too: `groups.flatMap(g => g.credentials).length` and sum of `maxTotal`).
- **Groups:** each source group is a section headed by `<PingDot settled />` + the group label as a tracked-uppercase mono caption (`font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase`) with the group's max points right-aligned in the same caption style. Sections wrapped in `FadeRise whileInView` (landing-section idiom).
- **Credential cards:** 2-col grid (`grid grid-cols-1 gap-3 sm:grid-cols-2`). Card = the neutral results-card shell: `rounded-lg border bg-card p-4 shadow-xs dark:bg-card/50 flex flex-col gap-1`. Content:
  - name (`text-base font-medium`) + `{max_score} pts` (`font-mono text-base tabular-nums tracking-tighter`) in a baseline row
  - value line: `text-sm text-muted-foreground` — "Measures: {describeValue}"
  - formula line: `text-sm text-muted-foreground/80 font-mono` — {formatFormula}
  - aggregation: `<Badge compact>` with `describeCalculation` (only when the app supports multi-wallet aggregation for it — always shown; both labels are meaningful)
  - note line when `displayNote` non-null: `text-sm text-muted-foreground/80`
- **Anchors:** each card carries `id={slug}` and `scroll-mt-16`; deep-linked card lights up via the Tailwind `target:` variant: `target:ring-1 target:ring-success/60` — the emerald signal marks the credential you were sent to. (Emerald-as-signal rule: this is a signal usage, sanctioned.)

## 3. Entry points

- **routes.ts:** `credentialsPath(slug?: string): string` — `/credentials` or `/credentials#<slug>`. URL shapes live only in routes.ts (repo convention).
- **Footer:** "Credentials" internal link, same idiom as "Verify", placed before it.
- **Landing:** the "Anyone can run it" value-prop card gains a final line: `See every credential →` (`Link` to `credentialsPath()`, `text-sm text-muted-foreground underline transition-colors hover:text-foreground`).
- **Results page (`/score/[wallet]`):** under the credential breakdown grid (after the Stagger block, before the computed-at footnote), a `FadeRise`'d link "Full credential reference →" (same link idiom) to `credentialsPath()`.

## 4. Testing

New `test/credential-reference.test.ts` (node env, matching repo test conventions):

- `groupCredentials` returns the 4 groups in scan order; their credentials cover exactly the spec's `poc: true` set (no dupes, none missing).
- Sum of group `maxTotal`s equals `computeScore`'s `maxTotal` from the engine for the same spec (drift guard — editing spec.json can never make the reference disagree with scoring).
- `formatFormula` golden cases: one per conversion used by active credentials (`no_conversion`, `sqrt`, `timestamp_to_year`) + `log` handled + unknown conversion throws.
- `describeValue` covers every `value` string present in the active set; unknown throws.
- `credentialsPath()` cases join `test/routes.test.ts`.

Existing 163 tests stay green. Build must prerender `/credentials` statically.

## 5. Error handling

None at runtime — the page renders build-time data. Helpers throw on unknown enum values so a bad spec edit fails the build/tests, never ships a wrong page.

## 6. Out of scope

- Deferred (`poc: false`) credentials and any "Planned" section.
- Per-credential routes or OG images; propose-change/discussion affordances; serving raw `spec.json`; README changes; any engine/spec/scoring change.

## 7. Motion & brand constraints (inherited)

- No motion behavior changes to existing components; the new page only composes existing primitives (`FadeRise`, `PingDot`, `Badge`).
- Emerald only as signal: the `target:` ring and PingDots are signal usages; everything else on the page is monochrome tokens.
- Semantic TEXT tokens (`-text` forms) apply if any semantic text is used (none is planned on this page).
