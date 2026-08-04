# Aggregate attestation: EIP-712 ownership proofs (Design)

**Date:** 2026-08-04
**Status:** Implemented. Schema registered on Base Sepolia as #2304 (2026-08-04). Not yet
exercised end-to-end against a real multi-wallet score.

## Goal

Multi-wallet scoring shipped on 2026-07-25; attesting the result did not. The attest panel
early-returned with "aggregate scores can't be attested" for two reasons: the schema anchors
exactly one wallet, and — the real blocker — nothing proved the user owned wallets 2–5.
Without that, anyone could borrow a whale's address into their aggregate and attest the total.

## Why this is not the SIWE we argued against

The [score-integrity design](2026-08-03-score-integrity-design.md) §2 rejected SIWE, and that
reasoning still holds. It was scoped precisely: *"a `personal_sign` in an app with no backend
produces a signature only the signer's own browser ever validates — ceremony with no
verifiable output."*

The objection was never the signature. It was that the result never left the browser.

Here the signature is **stored in the attestation**. It lands onchain, where anyone can
recover it, forever, with no server — and for an EOA, with no network call at all. That is a
verifiable output, so the objection does not transfer.

SIWE's *format* is still wrong for this, for a separate reason. EIP-4361 mandates `domain` and
`uri`, both bound to the serving origin. Since only the 65-byte signature is stored and the
payload is reconstructed at verify time, the verifier would need to know the exact origin —
which differs across localhost, Vercel previews, and production. The two escapes are both
worse: storing the origin wastes bytes and lets an attester pick an authoritative-looking
string, and pinning a constant domain trips MetaMask's mismatched-domain warning in the middle
of an ownership ceremony, which is the last place to teach users to click through warnings.

EIP-712 has a deterministic domain, a spec-frozen encoding, native `address[]`, and is what an
EAS resolver would consume if this ever moves onchain.

## Schema v2

```
string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,string github_handle,uint16 score,uint64 computed_at,uint64 block_number
```

UID `0xbe7ec06d063e733524e01fed24a3b028b71491cd4fee3616cc4b4fde4b9722ea`, from the repo's own
`computeSchemaUid(schema, zeroAddress, true)` — the same derivation reproduces v1's
`0x38b1a4ab…68d1cd` exactly, so it is confirmed rather than assumed. **Registered on Base
Sepolia 2026-08-04 as schema #2305**, and the UID in the `Registered` event matched the pin.
An earlier cut without `verify_url_prefix` was registered as #2304 and superseded with zero
attestations against it. Golden-pinned in
`test/eas.test.ts` alongside a `parseAbiParameters` field-order assertion, which is the guard
that the eas-sdk encoder and the viem decoder can never drift apart.

Decisions inside the schema:

- **`wallet` stays the primary**, rather than collapsing into one `address[] wallets`. It
  preserves `recipient == wallet` in `validateAttestation`, keeps `isSelfAttested` unchanged,
  and leaves `ownership_proofs[i]` a clean 1:1 with `extra_wallets[i]` — no off-by-one, no
  empty slot for the primary, which needs no proof because `msg.sender` is its proof.
- **`bytes[]`, not fixed width.** A smart account returns an ABI-encoded signature wrapper,
  and a counterfactual one returns an ERC-6492 wrapper of several hundred bytes. A
  fixed-width field would exclude every smart account on Base. Signatures are stored verbatim
  and never unwrapped: the wrapper is what makes a counterfactual signature verifiable, and it
  stays valid after deployment.
- **No `proof_version` field.** The schema UID is the format version.
- **`score_url` + `badges` (schema #2306).** See below. Supersedes `verify_url_prefix`.
- **`verify_url_prefix`, not `verify_url`** (schema #2305, superseded). A whole URL is impossible: EAS computes an
  attestation's UID as `keccak256(abi.encodePacked(schema, recipient, attester, time,
  expirationTime, revocable, refUID, data, bump))` — `data` is in the preimage, verified by
  recomputing a live attestation's UID from its fields and getting an exact match. So a URL
  containing the UID changes the UID it names. The field holds `https://talentprotocol.com/verify/`
  and a reader appends the UID EAS already records. Named `_prefix` so nothing onchain implies
  it is directly openable. Derived from `SITE_ORIGIN` so it cannot drift from the app's routes.
- **v1 stays live and untouched.** `attestScore` is byte-for-byte unchanged and single-wallet
  scores still use it, so a regression in the aggregate path cannot break the shipped one.

## The signed payload

```ts
domain  { name: 'Open Builder Score', version: '1', chainId: ATTEST_CHAIN_ID, verifyingContract: EAS }
message WalletOwnership { statement, wallet, primary, wallets[], computedAt, expiresAt }
```

`wallets` is `[primary, ...extras]` with extras deduped case-insensitively and sorted
ascending — so the onchain `extra_wallets` array *is* the canonical array.

- **`expiresAt` is derived** (`computedAt + 24h`), so nothing extra is stored and nothing can
  be forged. At verify time we check `att.timeCreated <= expiresAt`; `timeCreated` is written
  by EAS and the attester cannot choose it, which turns the window from decoration into a real
  assertion: the attestation was submitted inside the window the signer consented to. 24h
  rather than 1h because the window's job is to kill year-old proofs, not to be a nonce.
- **No nonce.** Replay into another aggregate is impossible by construction — `primary` and the
  full set are bound. There is nothing to replay a proof into except an attestation carrying
  the identical tuple, which is a duplicate of a claim the signer already made.
- **Domain `version` is decoupled from `spec.version`.** Binding the spec would force
  re-signing every wallet on every credential re-cut, and the ownership claim is about
  wallets, not about the score.
- **Score and GitHub handle are deliberately not bound.** Those are verified by recomputation.
  Binding them would mean re-collecting signatures whenever a credential moved, for no gain.

An empirical note worth recording, because it corrects a plausible assumption: the `wallet`
field is *not* load-bearing for the index-swap defence. ECDSA recovery already identifies the
signer, so swapping two valid proofs between indices fails with or without it. Verified by
removing the field and watching the swap test still pass. It is kept because it makes the
signing prompt legible. The `primary` binding **is** load-bearing — removing both it and the
primary's slot in `wallets` makes the wrong-primary test fail, which is the whale-borrowing
defence, confirmed the same way.

## Verification, and what it can honestly claim

`verifyOwnershipProofs` in `src/lib/ownership.ts`, framework-free with injectable I/O:

1. missing or `'0x'` → `missing`
2. outside the window → `expired`, **skipping the network call entirely**
3. offline `recoverTypedDataAddress` → match → `eoa`
4. otherwise `verifyTypedData` (ERC-1271 / ERC-6492, via viem's deployless universal
   validator) → `contract` / `invalid`
5. RPC throws → **`unchecked`, reason preserved**

Step 5 matters: an RPC hiccup while asking a smart account whether it accepts a signature must
never render as "forged". That is the repo's own "couldn't check ≠ not earned" rule, already
applied in `chains.ts` and `mergeCredentialInputs`, extended to signatures.

- **EOA proofs are unconditionally verifiable offline, permissionlessly, forever.** Recovery
  is arithmetic over bytes already on Base. Copy says so without qualification.
- **Smart-account proofs are not.** ERC-1271 asks a contract whose owner set is mutable, so the
  answer describes state at the block you ask. We verify at `latest` and label it as such. viem
  does thread `blockNumber` through, so the lib exposes it for archive-node users, but public
  Base RPCs prune state (~128 blocks) so as-of-block is not the default.

**This is not a hypothetical path here.** Both wallets that have used the single-wallet schema
on Base Sepolia — `0x33041027…` (which registered schema #2265) and `0xc8B74c37…` — are
**EIP-7702 delegated EOAs**, sharing the delegate `0x63c0c19a…` and exposing a live
`isValidSignature`. Two consequences:

1. A 7702 account signing with its own key still produces a plain ECDSA signature, so offline
   recovery succeeds *even though the account has code*. Trying recovery before the contract
   call is therefore not just an optimisation — it is what keeps these wallets on the
   permissionless path. The same ordering, for the same reason, is used by
   `node-api/src/api/GET/verifySiweSignature.ts` in the main Talent stack.
2. A 7702 delegation can be re-pointed or revoked at any time. That is precisely the
   mutability the ERC-1271 caveat describes, and it applies to ordinary MetaMask users here,
   not only to contract wallets.

**Ownership never enters `classifyAttestation` or `scoreVerdict`** — the same line the repo
already drew for `isSelfAttested`. Structural problems (length mismatch, empty extras,
over-cap, non-ascending order, an extra repeating the primary) are `malformed`, because those
are encoding integrity. Whether a signature verifies is a separate displayed fact. Pinned by a
test asserting an aggregate with garbage proofs still classifies `ok`. The over-cap check also
bounds the verify page's RPC fan-out, so a hostile attestation can't storm the verifier.

## UI

The attest panel was restructured to **one return with `ConnectButton` always mounted**; every
gate is now an inline note that disables an action rather than replacing the panel. Three early
returns previously unmounted it — fine when the user only had to connect one wallet, wrong now
that the flow requires switching accounts repeatedly.

That restructure also fixed a latent bug: the "Switch to Base Sepolia" button was gated behind
`walletOwned`, so while connected as an *extra* wallet the switch control vanished.

Chain switch must precede signing — MetaMask rejects `eth_signTypedData_v4` when
`domain.chainId` doesn't match the active chain. Flow: connect → switch once → sign per extra
→ attest as primary. Rows render in canonical order, so the visual index equals the onchain
proof index. Exactly one row can ever have an enabled button.

**Each signature is verified before it is stored.** A wallet quirk would otherwise produce an
attestation whose proof fails at verify time — after gas was spent. This turns a permanent
onchain embarrassment into a pre-flight error.

**Proofs live in component state, not sessionStorage** — not for convenience, because
sessionStorage would be actively wrong. A reload re-runs `gatherMultiInputs`, minting a new
`computedAt`, which is bound into every signature; persisted proofs could only ever be stale.
Account switching does not remount, which is the case that actually matters.

The expiry is checked inside `handleAttest` and rendered as static text. No timer: the repo has
a documented burn from time-coupled state, and a stale render costs one clear error.

`Scored.extraAddresses` is deliberately **not** canonicalised upstream — the results page and
`inputPath` keep the user's typed order so shared URLs stay stable. Canonicalisation happens at
the attestation boundary and nowhere else.

## Verified facts that shaped this

Checked against the code, not assumed:

- **The as-of anchor is documentary, not a query parameter.** `readChainCredentials` calls
  `client.multicall` with no `blockNumber` and the verify page re-mints `computedAt`. So the
  aggregate anchor question answers itself: keep the primary's `baseBlockNumber`.
- Recomputation is order-invariant, which is what lets the schema store a sorted set —
  `sum_all` and `max_value` are both commutative, and merge order affects only the
  `unavailable` reason string. Pinned in `test/orchestrate.test.ts` by scoring `[A,B]` and
  `[B,A]` and comparing totals.
- `decodeAttestationData` had **three** consumers, not two (`percentile.ts` was the third).
- `HISTORY_QUERY` did not select `schemaId`; it must, or two-schema history would have to
  trial-decode. `schemaId: { in: [...] }` works on easscan's GraphQL.
- **No new dependencies.** viem supplies EIP-712 hashing, recovery, ERC-1271/6492 verification
  and `privateKeyToAccount` for tests; wagmi supplies `useSignTypedData`; the eas-sdk
  `SchemaEncoder` handles `address[]` and `bytes[]` — round-tripped in `test/eas.test.ts`.

## Out of scope

Promoting to Base mainnet (`ATTEST_CHAIN_ID` stays 84532, matching "mainnet deferred until
after Sepolia validation"). Aggregates in the percentile corpus. Showing an aggregate in the
history of an extra wallet — the recipient is the primary, so it appears only there.

## A note on who registers the schema

easscan's `creator` field on a schema reports the **transaction sender**, not the registerer.
For schema #2265 that reads `0xB01caEa8…`, which is MetaMask's gas-station EOA — it paid and
broadcast, nothing more. EAS's own `Registered(bytes32,address,…)` event records the registerer
as `0x33041027…`, reached through a delegation contract. Read the event, not the easscan field,
if it ever matters who registered a schema. It does not matter for security: `SchemaRegistry`
never checks the registerer, and anyone may attest against any schema.

## Registration

Done: schema #2304, tx `0x1ed8088d…af4b`, registrant `0xC925bD0E839E8e22A7DDEbe7f4C21b187deeC358`,
resolver `0x0`, revocable. The script that did it is committed at
`scripts/register-aggregate-schema.mjs`:

```sh
node --env-file=.env scripts/register-aggregate-schema.mjs          # preflight
node --env-file=.env scripts/register-aggregate-schema.mjs --send   # register
```

It reads `ATTESTATION_WALLET_KEY` from the environment and never logs it, reads the schema
string out of `src/lib/eas.ts` so there is one source of truth, refuses to send if the computed
UID doesn't match the pin, is idempotent (exits early if already registered), and verifies the
UID from the `Registered` event rather than trusting its own computation. The same script
registers on Base mainnet by switching the chain when `ATTEST_CHAIN_ID` moves.

Note the registrant is a plain EOA here, unlike schema #2265 — see the note above on why
easscan's `creator` field is not a reliable answer to "who registered this".

## score_url and badges

`score_url` is a complete, openable link to the app's score view for exactly this wallet set,
built by `absoluteUrl(scorePath(…))` so it cannot drift from real routing. It points at the
score rather than at the attestation for the same circularity reason: EAS derives the UID from
a hash over the data, so a URL naming that UID cannot exist inside it. The earlier
`verify_url_prefix` was correct but read as truncated to anyone skimming easscan.

`badges` records the slugs earned at scan time. They are zero-point by construction and can
never move a score. **But two of the four have no permissionless source** —
`builder_score_100` and `builder_rewards_earned` are dated exports from Talent Protocol's
database. Recording them onchain is a real departure from "an attestation anyone can verify by
recomputing," which is why badges were originally excluded.

The departure is contained rather than hidden: `classifyAttestedBadges` marks a badge
re-derivable when it has any non-snapshot check, and the verify screen prints either
`re-derivable from public data` or `rests on a dated Talent Protocol export — recorded, not
independently checkable`. `$BUILD Contributor` counts as re-derivable because its checks are
OR-ed and the live `donated()` read stands alone. An unknown slug stays visible rather than
being dropped, since hiding it would understate the claim. Only `state === 'earned'` badges are
written — `unavailable` is not `earned`.

**Schema churn, recorded honestly.** #2304 (no URL field, 0 attestations), #2305
(`verify_url_prefix`, 1 real attestation), #2306 (current). #2305 is kept as a decode-only
legacy path in `verify.ts` so that attestation keeps verifying — the same rule that kept the
single-wallet schema alive. Nothing is ever attested against it again.

## Schema metadata on easscan

Named and described on 2026-08-04 via EAS's two well-known metadata schemas (#1
`bytes32 schemaId,string name`, #1010 `bytes32 schemaId,string description`), sent from the
registrant so easscan flags them `isCreator: true`. Script: `scripts/set-schema-metadata.mjs`.

What was checked before spending anything, because it decides what is even possible:

- **easscan renders both fields as plain text.** No markdown — proven by a schema whose
  description contains `# markdown h1` and backticks, which display literally. No autolinking
  either — proven in a real browser against an attestation whose value is a URL, and again on
  our own schema page after publishing (`urlIsLink: false`). So the URL is copy-paste, not
  clickable, and it is worded accordingly ("open … followed by its UID").
- **A per-attestation deep link is impossible.** `SchemaRegistry` stores only
  `(uid, resolver, revocable, schema)`, and our schema has no spare string field. A
  `verify_url` field would have had to be decided before registration. Worth remembering if a
  v3 is ever cut.
- **#2265 cannot be named authoritatively.** easscan's `creator` is the transaction sender,
  which for #2265 is MetaMask's gas-station wallet — so no one can attest metadata for it as
  the creator. It is left unnamed behind `--include-single`. This is the concrete cost of
  gas-sponsored registration, and the reason #2304 was registered from a key we hold.

## Remaining

The aggregate attest path is untested end-to-end; every unit test around it passes. And
`https://talentprotocol.com/verify/<uid>` — now permanent in the schema description — needs a
rewrite in talent-apps before it resolves; see the README's "Canonical domain" section.

For the end-to-end pass, exercise a 7702 delegated EOA as an extra wallet (the default for
these accounts) *and* a wallet that returns a wrapped signature, so both the `eoa` and
`contract` branches are covered by something real rather than an injected fake.
