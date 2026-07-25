# Verifier View (Design)

**Date:** 2026-07-25
**Status:** Approved via roadmap delegation (Francisco: "the rest i agree with, so feel free to plan it and go for it")
**Builds on:** POC + UX overhaul (spec 2026-07-25). Closes the "anyone can verify by
recomputing" loop with a one-click verifier.

## Goal

Paste (or deep-link) a Builder Score attestation UID → the browser fetches the
attestation from easscan, decodes it, recomputes the score for the attested
wallet/handle from live public data, and renders an honest verdict.

## Routes

- **`/verify`** (client): one labeled input for the attestation UID
  (validated `0x` + 64 hex chars), submit navigates to `/verify/[uid]`.
- **`/verify/[uid]`** (client): the verifier. Phases:
  1. *Fetching attestation…* — easscan GraphQL lookup by UID.
  2. Static classification (no recompute needed), precedence
     malformed > revoked > spec_mismatch > ok:
     - ❌ **malformed** (red card listing all problems + link back to
       `/verify`): UID malformed / attestation not found / easscan
       unreachable / `schemaId` ≠ our `ATTEST_SCHEMA_UID` / data doesn't
       ABI-decode against our schema / `recipient` ≠ decoded `wallet`.
     - ⚠️ **not comparable** (amber card + attestation details, no
       recompute) for *authentic* attestations we can't compare: revoked
       (`revocationTime` ≠ 0, framed as "withdrawn", not as invalid), or
       attested `spec_version` ≠ current `spec.version` (we can only
       faithfully recompute the spec this app ships).
  3. *Recomputing…* — existing `gatherInputs` + `computeScore` for the decoded
     wallet + github handle (current time anchor; drift is expected and named).
  4. Verdict banner:
     - ✅ **match** — recomputed total equals the attested score.
     - ⚠️ **diverged** — totals differ; copy explains scores drift as public
       data changes and divergence ≠ the attestation was wrong when made.
     - ⚠️ **incomplete** — recompute had unavailable sources
       (`!score.complete`); comparison is explicitly partial.
  5. Details list (wallet linking to its `/score/…` page, github handle, spec
     version, attested-on date, the embedded as-of anchor — computed-at time
     and Base block — attester, easscan link) + the full recomputed
     per-credential breakdown (reusing `CredentialCard`). The details list is
     shared with the not-comparable card (which omits the breakdown).
- Segment layout `/verify/layout.tsx` (server) provides static metadata for
  both pages.

## Lib

`src/lib/verify.ts` — framework-free, unit-tested with an injectable fetch:

- `EASSCAN_GRAPHQL` derived from `ATTEST_CHAIN_ID` (Sepolia now, mainnet later).
- `ATTESTATION_QUERY` — singular `attestation(where: { id })` returning
  `id schemaId recipient attester revocationTime timeCreated data`.
- `isAttestationUid(value)` — UID shape check.
- `fetchAttestation(uid, fetchFn = fetch)` → `{status:'found',attestation} |
  {status:'not_found'} | {status:'error',reason}` with tolerant response
  parsing (`parseAttestationResponse`, same defensive style as easscan.ts).
- `decodeAttestationData(hex)` → `{specVersion, wallet, githubHandle|null,
  score, computedAt, blockNumber}` via viem `decodeAbiParameters`
  (`string,address,string,uint16,uint64,uint64`); `null` on decode failure.
- `validateAttestation(att, decoded)` → `string[]` of human-readable problems
  (empty = valid).
- `scoreVerdict(attestedScore, recomputed)` → `'match' | 'diverged' |
  'incomplete'`.

`src/lib/routes.ts` gains `verifyPath(uid: string | null = null)`.

## Entry points

- Footer: "Verify" link (→ `/verify`) beside the spec version.
- Attest panel success state: alongside the existing easscan link, an internal
  "Verify it" link to `/verify/<new uid>`.

## Constraints carried forward

Same global constraints as the UX overhaul (no webpack key, no new deps, URL
shapes only in routes.ts, zinc+emerald aesthetic, `use()` for Promise params,
all existing tests green). No changes to engine/fetchers/attest logic.

## Out of scope

OG images, verifying foreign spec versions, batch verification, mainnet flip.
