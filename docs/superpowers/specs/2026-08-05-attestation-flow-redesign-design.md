# Attestation flow redesign: any-wallet attester, ownership checklist (Design)

**Date:** 2026-08-05
**Status:** Approved, not implemented.
**Supersedes:** the signed-payload binding and the attest-panel flow of
[2026-08-04-aggregate-attestation-design.md](2026-08-04-aggregate-attestation-design.md).
That spec's verification machinery (EOA-first recovery, ERC-1271/6492, `unchecked`,
schema-history rules) carries forward unchanged.

## Problem

First real-user feedback on the aggregate attest flow, 2026-08-05:

1. The flow feels awkward and error messages are poor.
2. The user expected to be asked to sign right when adding extra wallets.
3. "Why do I have to switch to the other wallet? Can't any of them attest?
   Primary wallet doesn't make much sense here."

Code findings behind each complaint:

- The "primary must attest" rule is UI-only (`attest-panel.tsx:78-84`). Onchain,
  the schema has no resolver and `validateAttestation` never inspects the attester.
  The rule existed because `msg.sender` is a free ownership proof for one wallet.
- Of the five `canAttest` conditions, two render a banner and three fail silently —
  a user with an unsigned extra sees a dead button with no reason.
- Raw wallet/RPC `e.message` strings land verbatim in the UI
  (`attest-panel.tsx:93,111,150,189`).
- Every signature binds `computedAt`, so a reload re-scans, mints a new
  `computedAt`, and silently invalidates all collected proofs.
- "Primary" suggests a privileged wallet. It also collides with talent-api's
  unrelated `main_wallet` concept, compounding the confusion.

## Decisions

**1. Trust model: every wallet in the set must be proven — by signature or by
being the transaction sender.** Any wallet of the set may send the attest
transaction; its `msg.sender` is its proof, and every other wallet (the
recipient included) needs a valid EIP-712 proof. This keeps the exactly-N proofs
economy (N−1 free signatures + 1 tx) while removing the forced final switch and
the asymmetry that generated the feedback.

Considered and rejected:

- *Optional proofs, downgraded at verify* — permissionless to the end, but most
  users would skip signing and aggregates would stop being trustworthy by
  default, against "verified data, not self-reported".
- *No proofs at all* — an aggregate's only content beyond N individual scores is
  the claim "one person owns all of these". Without proofs that claim is open to
  reputation borrowing (attest "my wallet + a whale") with no warning anywhere.

**2. "Primary" dies as a concept.** An EAS attestation has exactly one
`recipient`, and recipient is how everyone (including talent-api's
`account_attestation_ownership`) queries easscan — so one wallet must remain the
address the score is filed under. That is all it is now: *the score's address* —
attestation recipient and URL anchor, chosen by the user as the first form
field, with no signing privilege and no special checklist treatment. The word
"primary" disappears from UI copy, code identifiers, and the signed message.

**3. Signatures are collected on the results screen only, as an ownership
checklist.** The score form stays untouched: typing arbitrary addresses/ENS to
*view* an aggregate remains signature-free, preserving "connecting a wallet is
only needed to attest".

**4. Proofs re-anchor from `computedAt` to their own `issuedAt`.** The 2026-08-04
spec already states the principle — "the ownership claim is about wallets, not
about the score" — and binding the scan timestamp contradicts it. With an
independent anchor, proofs survive reloads and re-scans and can be persisted.

**5. No raw wallet errors.** Every failure point gets its own human message;
technical detail is collapsible, never the headline.

## Signed payload v2

```
domain  { name: 'Open Builder Score', version: '2', chainId: ATTEST_CHAIN_ID, verifyingContract: EAS }
message WalletOwnership { statement, wallet, recipient, wallets[], issuedAt, expiresAt }
```

- `primary` → `recipient`, `computedAt` → `issuedAt`. The typehash changes with
  the field names, so a v1 signature can never validate as v2 by construction;
  the domain version bump is for legibility, not safety.
- `issuedAt` is minted once per canonical wallet set when the checklist first
  needs it, not per signature — one shared anchor keeps the schema to a single
  `uint64` instead of a per-proof array, and "your signatures expire together,
  24h after you started" is also the easier story to tell.
- `expiresAt` stays derived (`issuedAt + 24h`), nothing stored beyond the anchor.
- Verify keeps `att.timeCreated <= expiresAt` and adds the symmetric check
  `issuedAt <= att.timeCreated`: proofs must have been issued before the
  attestation landed. EAS writes `timeCreated`, so this caps future-dating the
  anchor to stretch the window — a hole `computedAt` technically shared and
  nothing exploited, closed while the message is being re-cut anyway.
- The lower bound carries a 10-minute skew allowance
  (`ISSUED_AT_SKEW_ALLOWANCE_SECONDS`): `issuedAt` is minted from the client's
  clock, but this check runs against the chain clock (`att.timeCreated`). A
  client clock running fast would otherwise brand an honest proof "expired"
  the instant it landed onchain — silently at attest, permanently once mined.
  10 minutes absorbs real-world clock drift while still capping how far
  `issuedAt` can be future-dated. The upper bound is exact, unaffected.
- Statement becomes: *"I own this wallet and consent to including it in an Open
  Builder Score aggregate issued to the recipient below."*
- Everything else from the 2026-08-04 payload rationale holds: no nonce (the
  set + recipient binding leaves nothing to replay into), no score/handle
  binding, domain version decoupled from `spec.version`.

## Aggregate schema v3

Current #2306 fields plus:

- `bytes recipient_ownership_proof` — `0x` when the recipient is the attester,
  its proof otherwise.
- `uint64 proofs_issued_at` — the shared anchor. Bound into every signature, so
  a forged value makes every proof fail recovery; it cannot be quietly edited.

The `wallet` field name and the `recipient == wallet` validation stay — the
schema never said "primary". `extra_wallets[i]` / `ownership_proofs[i]` stay
1:1; the attester's slot (whichever it is) holds `0x`.

Verify rule per wallet, recipient included: **valid proof, or
`wallet == att.attester`.** An attester outside the set is tolerated at verify
(then every wallet needs a proof) but never offered by the UI. Exactly one `0x`
slot is acceptable and only at the attester's position; a second missing proof
is `missing` as today.

Boundary between classification and ownership is unchanged from 2026-08-04:
structural problems are `malformed`, proof outcomes are a separately displayed
fact, and ownership still never enters `classifyAttestation` or `scoreVerdict`.
The verify page's "self-attested" badge becomes, for aggregates, "attested from
within the wallet set" vs "attested by an outside wallet"; single-wallet keeps
the current wording. This within/outside-set display applies to v3 aggregates
only (decoded via a non-null `proofsIssuedAt`) — legacy aggregates (#2305,
#2306, and the score_url/verify_url_prefix variants) predate the recipient
proof slot, so the recipient's only possible proof is being the attester
itself; they keep the plain self-attested pair instead, same as single-wallet.

Registration reuses `scripts/register-aggregate-schema.mjs` (schema string read
from `src/lib/eas.ts`, UID pinned and confirmed from the `Registered` event) and
`scripts/set-schema-metadata.mjs`. #2306 joins #2305 as a decode-only legacy
path in `verify.ts`; nothing new is attested against it. Still Base Sepolia —
mainnet promotion remains deferred, which is what makes another schema cut cheap.

## Results screen: ownership checklist

The `canAttest` condition soup becomes visible state for everything:

```
Prove ownership (signatures valid until 14:32 tomorrow)
  0xA…  score address    ✓ signed
  0xB…  connected now    ✓ proves itself by sending the transaction
  0xC…                   [Connect & sign]  ○

⚠ Wrong network → [Switch to Base Sepolia]
[Attest onchain]        ← enabled only when every row is green;
                          when disabled, the reason is on screen
```

- **One row per wallet, recipient included** — rendered in canonical order
  (visual index == onchain proof index, as today), the recipient marked only by
  a "score address" note.
- **Row states:** `✓ signed` / `✓ connected — proves itself by sending the tx` /
  `○ pending → [Connect & sign]`. The connect button keeps the
  disconnect-then-modal flow (the `eth_accounts` scoping reason at
  `attest-panel.tsx:99-103` still applies), and the silent no-op when
  `openConnectModal` is undefined is fixed — the button renders disabled with a
  note until the hook is ready.
- **Auto-prompt on connect:** when a newly connected wallet matches a pending
  row, the signature request fires immediately — no second click, no dead state.
  This is the "sign right away" behaviour the feedback expected, on the screen
  where it belongs. Each signature is still verified before it is stored.
- **Network before signatures:** MetaMask rejects `eth_signTypedData_v4` when
  `domain.chainId` mismatches the active chain, so the wrong-network banner sits
  above the checklist and per-row sign buttons are disabled until the switch —
  with the switch button always mounted (the v2 restructure's lesson).
- **One-line explainer above the checklist:** "Each wallet proves ownership
  once: the one that sends the transaction proves itself; the rest sign a free
  message."
- **Expiry is static text, no countdown** — "valid until \<time\>", re-checked
  inside `handleAttest`. The repo's documented burn from time-coupled state
  stands; a stale render costs one clear error.
- Data-completeness and GitHub-handle banners stay as they are.

## Proof persistence

Proofs and the `issuedAt` anchor move to localStorage, keyed by the canonical
wallet set (lowercased, sorted, recipient first — the same array the signature
binds). Reloads and re-scans no longer discard signatures; entries are dropped
when read after `expiresAt`.

The 2026-08-04 spec argued persisted proofs "could only ever be stale" — that
was a consequence of binding `computedAt`, and re-anchoring is precisely what
dissolves it. localStorage over sessionStorage so a closed tab within the 24h
window doesn't cost the signatures either.

## Error messages

Every failure point maps to a human message; the raw error is preserved in a
collapsed "technical detail" disclosure, never as the headline. EIP-1193 code
mapping (the pattern talent-apps already uses in `useLinkWallet.ts`, implemented
locally — this repo stays dependency-free of talent-apps):

| Failure | Message |
|---|---|
| 4001 user rejection (sign, switch, or tx) | "Cancelled in the wallet." — neutral tone, not styled as an error, action stays ready to retry |
| Network switch failed | "Couldn't switch to Base Sepolia — switch manually in your wallet and try again." |
| Signature recovers to a different account | current message kept (already good) |
| Attest tx reverted/failed | "The attestation failed onchain. Nothing was spent besides gas. Try again." + collapsed detail |
| RPC/network unavailable | "Couldn't confirm right now — check your connection and try again." |

## Copy

"Primary" is removed from: the score form (first field becomes "the address the
score is for"), every attest-panel string, and the README "Ground rules"
section, which is rewritten for the new trust model. No copy anywhere implies
the score's address signs anything.

## Out of scope

- talent-apps and talent-api — untouched. The talent-app wallet-add flow
  already signs at the right moment; talent-api's `main_wallet` is a separate
  concept that never touches this flow.
- Single-wallet attestation — with a set of one, "any wallet of the set"
  degenerates to self-attest, which is current behaviour. It inherits only the
  new error messages.
- Mainnet promotion, aggregates in the percentile corpus, aggregate visibility
  in extra wallets' history — all deferred as before.

## Testing

- `ownership.ts`: payload v2 golden vectors; verification passes with the
  attester's slot empty at each possible position (recipient, each extra);
  fails with two empty slots or an out-of-set attester lacking full proofs;
  `issuedAt <= timeCreated <= expiresAt` window edges.
- `eas.ts` / `verify.ts`: schema v3 UID golden-pinned with the
  `parseAbiParameters` field-order assertion; #2305/#2306 decode-only paths
  still verify; aggregate with garbage proofs still classifies `ok`
  (classification/ownership boundary preserved).
- Checklist: row-state machine, auto-prompt on connect, signature verified
  before storage, localStorage round-trip and expiry drop, re-scan preserving
  proofs.
- Existing v2 payload/schema tests updated to v3 expectations.
- End-to-end on Base Sepolia with a 7702 delegated EOA as an extra and a
  wrapped-signature smart account, per the 2026-08-04 "Remaining" note — now
  also exercising an *extra* wallet as the transaction sender.
