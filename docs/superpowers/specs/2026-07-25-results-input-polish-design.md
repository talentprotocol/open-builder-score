# Results & Input Polish (Design)

**Date:** 2026-07-25
**Status:** Approved via roadmap delegation (Francisco: "the rest i agree with, so feel free to plan it and go for it")
**Builds on:** UX overhaul + verifier view (both merged 2026-07-25).

## Goal

Five UX/data improvements to the existing screens: ENS names as input,
per-source loading progress, retry, copy-link, and attestation history.

## Features

### 1. ENS names accepted anywhere a wallet goes

- New framework-free `src/lib/ens.ts`:
  - `looksLikeEnsName(value)` — dotted, no whitespace, length > 2.
  - `resolveEnsName(name, resolver?)` → `{status:'resolved', address} |
    {status:'unresolved'} | {status:'error', reason}`; normalizes via viem
    `normalize` (throws → error), resolves via injectable resolver (default:
    a lazily-created viem mainnet client using the same public RPC fallback
    list as `chains.ts`, which newly exports `MAINNET_RPC_URLS`).
- `/score` form: if input `isAddress` → navigate as today; else if
  `looksLikeEnsName` → resolve (button shows "Resolving name…", disabled),
  then navigate with the resolved address; unresolved/error → inline
  message. Label/copy updated to mention ENS.
- `/score/[wallet]`: an ENS name in the URL segment resolves and
  `router.replace`s to the canonical `/score/0x…` URL (shareable links like
  `/score/vitalik.eth` work). Failure → the normal error card.
- Landing "how it works" step 1 mentions ENS.

### 2. Per-source loading progress

- `gatherInputs` gains an optional 4th param
  `onSourceSettled?: (source: GatherSource) => void` where
  `GatherSource = 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'`;
  each fetcher promise reports on settlement (`.finally`). Backward
  compatible; unit-tested.
- Results loading state becomes a 4-row checklist (pending ○ zinc /
  done ✓ emerald): "Onchain badges & balances (6 chains)", "GitHub",
  "SpeedRun Ethereum", "EAS attestations".

### 3. Retry

- An `attempt` counter re-runs the results effect. "Try again" appears in
  the error card (alongside the back link) and inline in the partial-score
  amber note. Full re-gather (idempotent, seconds) — no surgical per-source
  retry (YAGNI).

### 4. Copy link

- `src/components/copy-link-button.tsx`: copies `window.location.href` via
  the clipboard API, 2s "Copied!" feedback, silent no-op if clipboard is
  unavailable. Rendered next to "Edit inputs" on results.

### 5. Attestation history

- New framework-free `src/lib/history.ts`:
  `fetchScoreAttestationHistory(wallet, fetchFn?)` — easscan GraphQL list
  query for our schema + recipient (newest first, take 20), each entry ABI-
  decoded via `decodeAttestationData`; tolerant parsing skips undecodable
  entries; returns `{status:'ok', attestations: ScoreAttestationSummary[]}
  | {status:'error'}` where a summary is `{uid, score, specVersion,
  timeCreated, revoked}`.
- `src/components/attestation-history.tsx`: self-fetching client component
  rendered under the attest panel on results; hidden entirely while
  loading, on error, or when empty (supplemental section — silent failure
  is acceptable). Rows link to `/verify/<uid>`; revoked rows struck
  through and labeled.

## Constraints carried forward

Same as prior phases: no webpack key, no new deps, URL shapes only via
routes helpers, zinc+emerald aesthetic, `use()` Promise params, engine and
fetchers untouched except the additive `onSourceSettled` and the
`MAINNET_RPC_URLS` export, all existing tests green.

## Out of scope

Per-source surgical retry, reverse-ENS display names, history pagination.
