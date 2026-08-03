# Score Integrity: sign-in, wallet ownership, credential re-cut (Design)

**Date:** 2026-08-03
**Status:** Implemented on `feat/score-integrity`.

## Goal

Three separate integrity gaps, one branch: GitHub sign-in that silently did
nothing, an attestation that proved nothing about wallet ownership, and a
credential set that paid 61 of 257 points for things that aren't building.

## 1. GitHub sign-in did nothing

Two bugs, both of which present as "no feedback, nothing happens".

1. **The four raw buttons in `github-sign-in.tsx` had no `type`.** HTML defaults
   a typeless button inside a form to `type="submit"`, and the component renders
   inside the `/score` form — so "Sign in with GitHub" also ran `handleSubmit`,
   and with the wallet field populated (it prefills from the connected wallet)
   `router.push` navigated away mid-request.
2. **`AnimatePresence mode="wait"` deadlocked the state machine.** It keeps the
   outgoing child mounted until its exit animation reports completion. Browsers
   pause animations in a hidden tab, and this flow *sends the user to
   github.com/login/device* — backgrounding the tab is the normal path. Verified
   against a hidden tab: the device-code request fired, eight token polls ran,
   and the DOM still read "Sign in with GitHub to verify your handle". The device
   code was never rendered. Replaced with a keyed `motion.div`: each state still
   fades in on mount, but nothing in the state machine waits on an animation.

**No secret is involved, and none is missing.** The device flow has no client
secret and no redirect URI by specification. Nothing needs configuring locally
or in Vercel. `NEXT_PUBLIC_GITHUB_CLIENT_ID` was added only so the app can be
pointed at a different GitHub app without a code change — the committed client
ID remains the default, so zero-config still holds.

Failures are now loud. GitHub reports `device_flow_disabled` and friends with
**HTTP 200 and an error body**, which the client used to flatten into "GitHub
returned an unexpected shape"; the real `error` / `error_description` now
surfaces. Both passthroughs share `relay()`, which guards the JSON parse and
adds a 10s timeout, so an HTML rate-limit page becomes a structured 502 instead
of a Next 500.

## 2. Wallet ownership, without SIWE

`attestScore` wrote `recipient: scored.address` with no check that the connected
wallet was the scored wallet, so anyone could attest a score onto an address
they don't control.

SIWE is the wrong tool here. EAS records `attester` as `msg.sender`, so the
attestation transaction **is** the ownership proof, and it is permissionlessly
checkable afterwards. A `personal_sign` in an app with no backend produces a
signature only the signer's own browser ever validates — ceremony with no
verifiable output.

- **Attest time:** the Switch/Attest controls only render when the connected
  wallet is the scored wallet; otherwise an amber note names both addresses.
  Rendered inline rather than as an early return, so `ConnectButton` stays
  mounted and the user can switch accounts.
- **Verify time:** `isSelfAttested(att, decoded)` compares checksummed
  `attester` to the attested `wallet`, surfaced as its own line under Attester.

Deliberately **not** folded into `classifyAttestation` or `scoreVerdict`:
attestations predating this gate legitimately have `attester !== wallet`, and
calling those malformed would be wrong. Score correctness and wallet ownership
are independent facts and are displayed as two.

## 3. Credential re-cut — 21 → 15, 257 → 196

`poc: boolean` became `status: 'active' | 'deferred' | 'excluded'` plus a
required `status_reason`. The old boolean conflated two opposite things:
`deferred` means we want it and can't compute it yet; `excluded` means it is
perfectly computable and we decided it isn't builder signal. `/credentials`
renders both, so the cut is as legible as the score.

Excluded (61 points): Farcon NYC 2025 (12, attendance), CNC Member (12,
membership), D_D Member (8, a buyable $CODE balance), $TALENT Balance (8) and
$TALENT Vault (8) — buyable, and our own token — and Base Learn (13, completion
SBTs on Base Sepolia, testnet being cheap to farm).

Multipliers are untouched, so every surviving credential earns exactly what it
earned before; only the ceiling moved. Spec bumped `0.1.1-poc` → `0.2.0`. The
fallout was already handled by design: `verify.ts` classifies older attestations
as `spec_mismatch`, and `percentile.ts` filters the corpus by version and
returns null on an empty one, which renders nothing.

**A side effect worth naming:** the scan's chain set is derived from the active
RPC slugs, so excluding credentials retired two whole chains — Ethereum went
with CNC and $CODE, Base Sepolia with Base Learn. Four chains instead of six is
fewer ways for a scan to come back incomplete, and incompleteness is what gates
attestation. Base survives, which matters because it carries the as-of block
anchor. `scannedChainCount()` derives the number the UI prints, pinned by test
against `buildChainPlan`, so the copy can't drift again.

## Out of scope

Multi-wallet (already shipped and working), aggregate attestation (needs a new
EAS schema), and the five deferred credentials (all need NFT token-metadata
enumeration).
