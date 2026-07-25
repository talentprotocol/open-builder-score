# Multi-Wallet Aggregation (Design)

**Date:** 2026-07-25
**Status:** Approved via roadmap delegation.

## Goal

Score a builder across up to 5 wallets at once — badges on one wallet, $TALENT
on another, all counted — matching production Builder Score's
all-connected-wallets semantics, while keeping attestation single-wallet so
the recompute-and-verify loop stays honest.

## Key decisions

1. **The engine already does the math.** `CredentialInput.accounts` is
   `number[]` and `computeScore` applies `sum_all` (sum across accounts) or
   `max_value` (best account) per credential — production semantics.
   Aggregation is therefore *pure input merging*: concatenate per-wallet
   `accounts` arrays per credential slug. Engine untouched.
2. **Honest unavailability propagates.** If any wallet's source is
   unavailable, the merged credential is `unavailable` — "couldn't check
   wallet 3" must not read as "not earned on wallet 3".
3. **Wallet cap: 5 total** (primary + 4 extras). Extras equal to the primary
   or to each other (case-insensitive, post-ENS-resolution) are silently
   deduped.
4. **URL shape:** `/score/[primary]?github=…&wallets=0xA,0xB` — extras as one
   comma-separated `wallets` query param, built only by `routes.ts`
   (`scorePath` / `inputPath` gain an optional `extras: string[]` argument;
   omitted/empty → today's URLs, byte-identical).
5. **One gather, four sources, N wallets.** New
   `gatherMultiInputs(addresses, githubHandle, fetchers?, onSourceSettled?)`
   in `orchestrate.ts`: chains/speedrun/verifiedBuilder fetched per wallet,
   GitHub once (it's handle-keyed); each source settles once, after all its
   wallets finish, so the 4-row checklist works unchanged; `computedAt`
   minted once at gather start; `baseBlockNumber` = the primary wallet's.
   `gatherInputs(a, …)` becomes a thin wrapper over
   `gatherMultiInputs([a], …)` — signature and all callers/tests unchanged.
6. **Attestation is single-wallet only.** The onchain schema anchors exactly
   one `wallet`; attesting an aggregate would make verification diverge by
   construction. With extras present, the attest panel shows an informational
   note (zinc) + a "Score this wallet alone" link to
   `scorePath(primary, github)`. Attestation history stays keyed to the
   primary. Verify page/lib untouched.
7. **`Scored` gains `extraAddresses: `0x${string}`[]`** (empty for
   single-wallet) so the results screen and attest panel share one truth.

## Pieces

- `src/lib/orchestrate.ts` — `mergeCredentialInputs(a, b)` (exported, pure:
  ok+ok → concat accounts; unavailable wins, first unavailable's reason),
  `gatherMultiInputs`, `gatherInputs` wrapper, `Scored.extraAddresses`.
- `src/lib/routes.ts` — `scorePath(wallet, github, extras = [])`,
  `inputPath(wallet, github, extras = [])`; trims, drops empty tokens.
- `src/app/score/page.tsx` (form) — extras prefilled from the `wallets`
  query param; "+ Add another wallet" (cap 4 extras) / per-row ✕ remove;
  submit resolves primary + extras in parallel (ENS allowed anywhere),
  errors labeled "Wallet N: …"; navigates with extras.
- `src/app/score/[wallet]/page.tsx` (results) — parses `wallets`, validates
  every token (address or ENS), resolves-then-canonicalizes via
  `router.replace` when any token is an ENS name, dedupes, calls
  `gatherMultiInputs`; address block lists extras one per line prefixed
  "+ "; chains checklist row reads "(6 chains, N wallets)" when N > 1;
  Edit-inputs link carries extras.
- `src/components/attest-panel.tsx` — multi-wallet informational note +
  single-wallet link, placed after the incomplete-data return, before the
  unverified-handle gate.

## Out of scope

Attesting aggregates (schema change), per-wallet score breakdown UI, OG
metadata mention of extras, verify-page changes, persisting wallet sets.

## Constraints carried forward

No new dependencies; engine/chains/github/speedrun/easscan/eas/verify/
history/ens untouched; URL shapes only in routes.ts; zinc + emerald, amber
for warnings; all 137 existing tests stay green; new logic unit-tested with
injectable fetchers.
