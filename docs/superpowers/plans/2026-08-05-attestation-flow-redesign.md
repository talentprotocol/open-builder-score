# Attestation Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any wallet of the scored set can send the aggregate attestation; every other wallet proves ownership with an EIP-712 signature collected through a visible checklist that survives reloads; no raw wallet errors reach the UI; "primary" disappears as a concept.

**Architecture:** The EIP-712 ownership payload re-anchors from the scan's `computedAt` to its own `issuedAt` (minted once per wallet set, persisted in localStorage), which is what makes proofs reload-safe. A new aggregate schema adds a proof slot for the recipient and the shared anchor; verification treats the transaction sender as exempt from carrying a proof. All previously registered schemas stay decode-only and keep verifying via a retained legacy path.

**Tech Stack:** Next.js 16 / React 19 client app, viem + wagmi + RainbowKit, eas-sdk, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-05-attestation-flow-redesign-design.md`

## Global Constraints

- Repo: `/Users/rubendinis/Documents/Code/talent/open-builder-score` (its own git repo; run all commands from this directory).
- Test command: `npm test` (vitest run). Single file: `npx vitest run test/<file>.test.ts`. Types: `npm run typecheck`. Lint: `npm run lint`.
- No new npm dependencies.
- `ATTEST_CHAIN_ID` stays `84532` (Base Sepolia). Mainnet promotion is out of scope.
- The word "primary" must not appear in any user-facing string after this plan. Internal identifiers rename to `recipient` where touched.
- Old attestations (single-wallet schema, aggregate schemas #2305 / score_url / verify_url) must keep decoding AND their ownership proofs must keep verifying — the legacy EIP-712 payload (fields `primary`/`computedAt`, domain version `'1'`) is retained for verification only.
- `OWNERSHIP_PROOF_TTL_SECONDS = 86_400` is unchanged.
- Golden pins: when a task says "pin the actual value", run the named test once with the placeholder `'0x0'`, copy the actual value from the failure output into the expectation, and re-run to green. Never invent pin values.
- This repo's Next.js is newer than your training data — read `node_modules/next/dist/docs/` if you touch routing/app-shell behaviour (this plan doesn't).
- Latent bug being fixed (context for Task 8): the current sign-time preflight at `src/components/attest-panel.tsx:131-137` verifies against `extras: [wallet]` while the signature bound the full extras set — with ≥2 extras every preflight fails. The redesigned flow always verifies within the full set.

---

### Task 1: Ownership payload v2 (+ retained legacy builder)

**Files:**
- Modify: `src/lib/ownership.ts` (lines 22-92: constants, types, builders)
- Test: `test/ownership.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (exact, used by Tasks 2, 6, 8):
  - `OWNERSHIP_DOMAIN_VERSION = '2'`
  - `OWNERSHIP_STATEMENT` (new text below)
  - `interface OwnershipMessageArgs { recipient: `0x${string}`; wallet: `0x${string}`; extras: `0x${string}`[]; issuedAt: number; chainId?: number }`
  - `ownershipTypedData(args: OwnershipMessageArgs)` — message fields `{ statement, wallet, recipient, wallets, issuedAt, expiresAt }`
  - `interface LegacyOwnershipMessageArgs { primary: `0x${string}`; wallet: `0x${string}`; extras: `0x${string}`[]; computedAt: number; chainId?: number }`
  - `legacyOwnershipTypedData(args: LegacyOwnershipMessageArgs)` — byte-identical to today's `ownershipTypedData`
  - `canonicalExtraWallets(recipient, extras)` — same behaviour, first param renamed

- [ ] **Step 1: Update the typed-data tests to the v2 shape**

In `test/ownership.test.ts`, rework the `ownershipTypedData` describe blocks. Replace `primary:` with `recipient:` and `computedAt:` with `issuedAt:` in every call to the (new) `ownershipTypedData`, keep the binding-guard structure, and add a legacy block. The reworked sections:

```ts
const ISSUED_AT = 1784975866
const lower = (a: `0x${string}`) => a.toLowerCase() as `0x${string}`
const digest = (args: Parameters<typeof ownershipTypedData>[0]) =>
  hashTypedData(ownershipTypedData(args))

describe('ownershipTypedData', () => {
  it('is casing-invariant — checksummed and lowercase inputs agree', () => {
    expect(
      digest({ recipient: PRIMARY, wallet: A, extras: [A, B], issuedAt: ISSUED_AT }),
    ).toBe(
      digest({
        recipient: lower(PRIMARY),
        wallet: lower(A),
        extras: [lower(A), lower(B)],
        issuedAt: ISSUED_AT,
      }),
    )
  })

  // Removal guards: catch a field being dropped from the payload, which would
  // silently widen what a signature authorises.
  it('binds every field it claims to', () => {
    const base = { recipient: PRIMARY, wallet: A, extras: [A, B], issuedAt: ISSUED_AT }
    const baseline = digest(base)
    expect(digest({ ...base, wallet: B })).not.toBe(baseline)
    expect(digest({ ...base, recipient: A })).not.toBe(baseline)
    expect(digest({ ...base, extras: [A] })).not.toBe(baseline)
    expect(digest({ ...base, issuedAt: ISSUED_AT + 1 })).not.toBe(baseline)
    expect(digest({ ...base, chainId: 8453 })).not.toBe(baseline)
  })

  it('is a different message family from the legacy payload', () => {
    expect(
      digest({ recipient: PRIMARY, wallet: A, extras: [A, B], issuedAt: ISSUED_AT }),
    ).not.toBe(
      hashTypedData(
        legacyOwnershipTypedData({ primary: PRIMARY, wallet: A, extras: [A, B], computedAt: ISSUED_AT }),
      ),
    )
  })
})

describe('legacyOwnershipTypedData golden vector', () => {
  // The v1 pin, unchanged: old attestations must keep verifying forever.
  it('hashes the fixed v1 tuple to the original pinned digest', () => {
    expect(
      hashTypedData(
        legacyOwnershipTypedData({
          primary: PRIMARY,
          wallet: EXTRAS[0],
          extras: EXTRAS,
          computedAt: ISSUED_AT,
        }),
      ),
    ).toBe('0xdc72c7e691a7d9f139bf4f3df6c220a2ca687119b6f99e51fd1c7fbbc2976a3c')
  })
})

describe('ownershipTypedData golden vector', () => {
  // Regenerate only when the proof format changes deliberately — and when it
  // does, the schema UID must change with it, because old proofs stop verifying.
  it('hashes a fixed tuple to a pinned digest', () => {
    expect(
      digest({ recipient: PRIMARY, wallet: EXTRAS[0], extras: EXTRAS, issuedAt: ISSUED_AT }),
    ).toBe('0x0')
  })
})
```

Also update the `canonicalExtraWallets` describe: the third test's name becomes `'drops the recipient — it is part of the set, not an extra'` (behaviour unchanged). Import `legacyOwnershipTypedData` at the top. Delete the old `COMPUTED_AT` constant name (now `ISSUED_AT`). Leave the `verifyOwnershipProofs` describes broken for now — Task 2 rewrites them; to keep this task's cycle green, comment them out with a `// Task 2 rewrites these` marker or temporarily adapt only the compile errors (preferred: comment out).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/ownership.test.ts`
Expected: FAIL — `ownershipTypedData` has no `recipient` in its type, `legacyOwnershipTypedData` not exported.

- [ ] **Step 3: Implement payload v2 in `src/lib/ownership.ts`**

Replace lines 22-75 (constants through `ownershipTypedData`) with:

```ts
export const OWNERSHIP_DOMAIN_NAME = 'Open Builder Score'

// v2: recipient/issuedAt replace primary/computedAt. The ownership claim is
// about wallets, not about the score — so the proof anchors to its own issue
// time, which is what lets signatures survive reloads and re-scans. The
// typehash changes with the field names, so a v1 signature can never validate
// as v2 by construction; the version bump is legibility, not safety.
export const OWNERSHIP_DOMAIN_VERSION = '2'

export const OWNERSHIP_STATEMENT =
  'I own this wallet and consent to including it in an Open Builder Score aggregate issued to the recipient below.'

export const OWNERSHIP_TYPES = {
  WalletOwnership: [
    { name: 'statement', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'wallets', type: 'address[]' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const

export interface OwnershipMessageArgs {
  recipient: `0x${string}`
  wallet: `0x${string}`
  extras: `0x${string}`[]
  issuedAt: number
  chainId?: number
}

// Deterministic in every input — nothing here reads the clock, so a proof can be
// reconstructed at verify time from the attestation alone.
export function ownershipTypedData(args: OwnershipMessageArgs) {
  const extras = canonicalExtraWallets(args.recipient, args.extras)
  return {
    domain: {
      name: OWNERSHIP_DOMAIN_NAME,
      version: OWNERSHIP_DOMAIN_VERSION,
      chainId: args.chainId ?? ATTEST_CHAIN_ID,
      verifyingContract: EAS_CONTRACT_ADDRESS,
    },
    types: OWNERSHIP_TYPES,
    primaryType: 'WalletOwnership' as const,
    message: {
      statement: OWNERSHIP_STATEMENT,
      wallet: args.wallet,
      recipient: args.recipient,
      wallets: [args.recipient, ...extras],
      issuedAt: BigInt(args.issuedAt),
      expiresAt: BigInt(args.issuedAt + OWNERSHIP_PROOF_TTL_SECONDS),
    },
  }
}

// ——— v1, verification-only. Attestations already onchain bound this exact
// shape; it must reproduce it byte-for-byte forever. Never sign with it.
export const LEGACY_OWNERSHIP_STATEMENT =
  'I own this wallet and consent to including it in this Open Builder Score aggregate.'

export const LEGACY_OWNERSHIP_TYPES = {
  WalletOwnership: [
    { name: 'statement', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'primary', type: 'address' },
    { name: 'wallets', type: 'address[]' },
    { name: 'computedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const

export interface LegacyOwnershipMessageArgs {
  primary: `0x${string}`
  wallet: `0x${string}`
  extras: `0x${string}`[]
  computedAt: number
  chainId?: number
}

export function legacyOwnershipTypedData(args: LegacyOwnershipMessageArgs) {
  const extras = canonicalExtraWallets(args.primary, args.extras)
  return {
    domain: {
      name: OWNERSHIP_DOMAIN_NAME,
      version: '1',
      chainId: args.chainId ?? ATTEST_CHAIN_ID,
      verifyingContract: EAS_CONTRACT_ADDRESS,
    },
    types: LEGACY_OWNERSHIP_TYPES,
    primaryType: 'WalletOwnership' as const,
    message: {
      statement: LEGACY_OWNERSHIP_STATEMENT,
      wallet: args.wallet,
      primary: args.primary,
      wallets: [args.primary, ...extras],
      computedAt: BigInt(args.computedAt),
      expiresAt: BigInt(args.computedAt + OWNERSHIP_PROOF_TTL_SECONDS),
    },
  }
}
```

Keep `MAX_EXTRA_WALLETS`, `OWNERSHIP_PROOF_TTL_SECONDS`, and `canonicalExtraWallets` as they are, but rename `canonicalExtraWallets`'s first parameter `primary` → `recipient` (body unchanged) and update its doc comment to say "recipient". Keep the file's top comment but rewrite its first paragraph to: "Ownership proofs for aggregate (multi-wallet) attestations. Every wallet in the set must be proven — by an EIP-712 signature stored in the attestation, or by being the transaction sender EAS records as the attester."

`src/components/attest-panel.tsx` and `src/app/verify/[uid]/page.tsx` will now have type errors (they pass `primary`/`computedAt`) — that is expected until Tasks 7-8; `npm test` doesn't typecheck the app, so the test cycle stays green.

- [ ] **Step 4: Pin the new golden vector and run**

Run: `npx vitest run test/ownership.test.ts -t 'golden'` — pin the actual value over `'0x0'` (see Global Constraints), then:
Run: `npx vitest run test/ownership.test.ts`
Expected: PASS (with the `verifyOwnershipProofs` describes commented out).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ownership.ts test/ownership.test.ts
git commit -m "feat: ownership payload v2 — recipient/issuedAt, legacy builder retained"
```

---

### Task 2: Full-set verification with attester exemption

**Files:**
- Modify: `src/lib/ownership.ts` (verification half: current lines 97-209)
- Test: `test/ownership.test.ts` (rewrite the commented-out describes)

**Interfaces:**
- Consumes: `ownershipTypedData`, `legacyOwnershipTypedData` (Task 1).
- Produces (exact, used by Tasks 7, 8):
  - `type ProofStatus = 'eoa' | 'contract' | 'invalid' | 'unchecked' | 'expired' | 'missing' | 'attester'`
  - `interface VerifyOwnershipArgs { recipient: `0x${string}`; extras: `0x${string}`[]; proofs: `0x${string}`[]; recipientProof: `0x${string}`; attester: `0x${string}` | null; issuedAt: number; at: number; chainId?: number; blockNumber?: bigint }`
  - `verifyOwnershipProofs(args, io?): Promise<ProofCheck[]>` — **returns checks aligned `[recipient, ...extras]`** (one more entry than before)
  - `interface LegacyVerifyOwnershipArgs { primary: `0x${string}`; extras: `0x${string}`[]; proofs: `0x${string}`[]; computedAt: number; at: number; chainId?: number; blockNumber?: bigint }`
  - `verifyLegacyOwnershipProofs(args, io?): Promise<ProofCheck[]>` — checks aligned with `extras` (today's behaviour, today's payload)
  - `aggregateProofSummary(checks)` — unchanged signature; `'attester'` counts as proved

- [ ] **Step 1: Rewrite the verification tests**

Uncomment and rewrite the `verifyOwnershipProofs` describes. New signing helper binds the v2 payload; checks now lead with the recipient. Key content:

```ts
const RECIPIENT = PRIMARY
const signerR = privateKeyToAccount(`0x${'33'.repeat(32)}`)

function signV2(signer: typeof signerA, wallet: `0x${string}`, over: { recipient?: `0x${string}` } = {}) {
  return signer.signTypedData(
    ownershipTypedData({
      recipient: over.recipient ?? RECIPIENT,
      wallet,
      extras: EXTRAS,
      issuedAt: ISSUED_AT,
    }),
  )
}

describe('verifyOwnershipProofs (v2, attester-exempt)', () => {
  const base = {
    recipient: RECIPIENT,
    extras: EXTRAS,
    issuedAt: ISSUED_AT,
    at: ISSUED_AT + 60,
  }

  it('accepts the recipient as attester with signed extras', async () => {
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const checks = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: '0x', attester: RECIPIENT },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['attester', 'eoa', 'eoa'])
    expect(aggregateProofSummary(checks)).toBe('all_proved')
  })

  it('accepts an extra as attester when the recipient signed', async () => {
    // EXTRAS[0] sends the tx; the recipient and EXTRAS[1] sign.
    // signerR does not control RECIPIENT, so verify via the contract path stub —
    // what matters here is slot arithmetic, covered exactly by the statuses.
    const recipientProof = `0x${'ab'.repeat(200)}` as const
    const proofs = ['0x', await signV2(signerFor(EXTRAS[1]), EXTRAS[1])] as `0x${string}`[]
    const checks = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof, attester: EXTRAS[0] },
      { verifyContractSignature: async () => true },
    )
    expect(statuses(checks)).toEqual(['contract', 'attester', 'eoa'])
  })

  it('rejects when a non-attester slot is empty', async () => {
    const proofs = ['0x', await signV2(signerFor(EXTRAS[1]), EXTRAS[1])] as `0x${string}`[]
    const checks = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: '0x', attester: RECIPIENT },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['attester', 'missing', 'eoa'])
    expect(aggregateProofSummary(checks)).toBe('failed')
  })

  it('demands every proof when the attester is outside the set', async () => {
    const OUTSIDE = '0x000000000000000000000000000000000000dEaD' as const
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const missingRecipient = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: '0x', attester: OUTSIDE },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(missingRecipient)).toEqual(['missing', 'eoa', 'eoa'])
  })

  it('short-circuits the attester slot before any proof check', async () => {
    // Garbage in the attester slot is irrelevant: msg.sender is the proof.
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const checks = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: `0x${'ff'.repeat(65)}`, attester: RECIPIENT },
      { verifyContractSignature: failIfCalled },
    )
    expect(checks[0].status).toBe('attester')
  })

  it('rejects a proof signed for a different recipient — the whale-borrowing defence', async () => {
    const OTHER = '0x000000000000000000000000000000000000dEaD' as const
    const proofs = await Promise.all(
      EXTRAS.map((a) => signV2(signerFor(a), a, { recipient: OTHER })),
    )
    const checks = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: '0x', attester: RECIPIENT },
      { verifyContractSignature: async () => false },
    )
    expect(statuses(checks)).toEqual(['attester', 'invalid', 'invalid'])
  })

  it('rejects two valid proofs swapped between indices', async () => {
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const checks = await verifyOwnershipProofs(
      { ...base, proofs: [proofs[1], proofs[0]], recipientProof: '0x', attester: RECIPIENT },
      { verifyContractSignature: async () => false },
    )
    expect(statuses(checks)).toEqual(['attester', 'invalid', 'invalid'])
  })

  it('enforces the window in both directions', async () => {
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const late = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: '0x', attester: RECIPIENT, at: ISSUED_AT + OWNERSHIP_PROOF_TTL_SECONDS + 1 },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(late)).toEqual(['attester', 'expired', 'expired'])
    // issuedAt after the attestation landed: proofs cannot postdate the record.
    const early = await verifyOwnershipProofs(
      { ...base, proofs, recipientProof: '0x', attester: RECIPIENT, at: ISSUED_AT - 1 },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(early)).toEqual(['attester', 'expired', 'expired'])
  })

  it('verifies one signature inside the full set (sign-time preflight)', async () => {
    // Regression for the old preflight bug: verification must always run against
    // the full extras set the signature bound, with the target's slot filled.
    const sig = await signV2(signerFor(EXTRAS[1]), EXTRAS[1])
    const checks = await verifyOwnershipProofs(
      { ...base, proofs: ['0x', sig], recipientProof: '0x', attester: null },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['missing', 'missing', 'eoa'])
  })
})
```

Keep the non-EOA/failure-path describes (`contract`, `invalid`, `unchecked` with reason, `blockNumber` threading) by porting them to the new call shape: add `recipientProof: '0x'`, `attester: RECIPIENT`, rename `computedAt` → `issuedAt`, and prepend `'attester'` to each expected status array. Add a legacy describe that ports today's `accepts an EOA signature offline` and `rejects a proof signed for a different primary` tests verbatim against `verifyLegacyOwnershipProofs` (same args as today's function). In `aggregateProofSummary` tests, add: `expect(aggregateProofSummary([{ wallet: w, status: 'attester' }, { wallet: w, status: 'eoa' }])).toBe('all_proved')`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/ownership.test.ts`
Expected: FAIL — `recipientProof`/`attester` not in `VerifyOwnershipArgs`, `verifyLegacyOwnershipProofs` not exported.

- [ ] **Step 3: Implement**

In `src/lib/ownership.ts`, add `'attester'` to `ProofStatus`. Replace `VerifyOwnershipArgs` and `verifyOwnershipProofs` with:

```ts
export interface VerifyOwnershipArgs {
  recipient: `0x${string}`
  extras: `0x${string}`[]
  /** Aligned with extras. The attester's slot, if among the extras, holds '0x'. */
  proofs: `0x${string}`[]
  /** '0x' when the recipient is the attester. */
  recipientProof: `0x${string}`
  /** att.attester when verifying; the connected wallet when attesting; null = no exemption. */
  attester: `0x${string}` | null
  issuedAt: number
  /** att.timeCreated when verifying, now when attesting. */
  at: number
  chainId?: number
  /** Public Base RPCs prune state, so as-of-block ERC-1271 needs an archive node. */
  blockNumber?: bigint
}

// Checks aligned [recipient, ...extras]: every wallet in the set is either the
// transaction sender (EAS records it as the attester — that IS its proof) or
// must carry a signature that verifies.
export async function verifyOwnershipProofs(
  args: VerifyOwnershipArgs,
  io: OwnershipIO = {},
): Promise<ProofCheck[]> {
  const chainId = args.chainId ?? ATTEST_CHAIN_ID
  const verifyContract = io.verifyContractSignature ?? defaultVerifyContract(chainId)
  const attester = args.attester?.toLowerCase() ?? null
  const wallets = [args.recipient, ...args.extras]
  const proofs = [args.recipientProof, ...args.proofs]

  return Promise.all(
    wallets.map(async (wallet, i): Promise<ProofCheck> => {
      // Before any proof check: msg.sender is authoritative and free, so
      // whatever occupies the attester's slot is irrelevant.
      if (wallet.toLowerCase() === attester) return { wallet, status: 'attester' }

      const signature = proofs[i]
      if (!signature || signature === '0x') return { wallet, status: 'missing' }

      // Both bounds, checked before any network call: signatures expire 24h
      // after their anchor, and cannot postdate the attestation they live in.
      if (args.at > args.issuedAt + OWNERSHIP_PROOF_TTL_SECONDS || args.at < args.issuedAt) {
        return { wallet, status: 'expired' }
      }

      const typedData = ownershipTypedData({
        recipient: args.recipient,
        wallet,
        extras: args.extras,
        issuedAt: args.issuedAt,
        chainId,
      })
      return checkSignature(wallet, typedData, signature, verifyContract, args.blockNumber)
    }),
  )
}

export interface LegacyVerifyOwnershipArgs {
  primary: `0x${string}`
  extras: `0x${string}`[]
  proofs: `0x${string}`[]
  computedAt: number
  at: number
  chainId?: number
  blockNumber?: bigint
}

// Verification for attestations that predate payload v2. Checks aligned with
// extras (the primary was exempt by construction back then).
export async function verifyLegacyOwnershipProofs(
  args: LegacyVerifyOwnershipArgs,
  io: OwnershipIO = {},
): Promise<ProofCheck[]> {
  const chainId = args.chainId ?? ATTEST_CHAIN_ID
  const verifyContract = io.verifyContractSignature ?? defaultVerifyContract(chainId)

  return Promise.all(
    args.extras.map(async (wallet, i): Promise<ProofCheck> => {
      const signature = args.proofs[i]
      if (!signature || signature === '0x') return { wallet, status: 'missing' }
      if (args.at > args.computedAt + OWNERSHIP_PROOF_TTL_SECONDS) {
        return { wallet, status: 'expired' }
      }
      const typedData = legacyOwnershipTypedData({
        primary: args.primary,
        wallet,
        extras: args.extras,
        computedAt: args.computedAt,
        chainId,
      })
      return checkSignature(wallet, typedData, signature, verifyContract, args.blockNumber)
    }),
  )
}
```

Factor the shared tail (offline `recoverTypedDataAddress` → `eoa`, then contract check → `contract`/`invalid`, throw → `unchecked` with reason — current lines 166-196 verbatim) into:

```ts
type VerifyContractFn = (args: VerifyContractSignatureArgs) => Promise<boolean>

function defaultVerifyContract(chainId: number): VerifyContractFn {
  return ({ address, typedData, signature, blockNumber }) =>
    clientFor(chainId).verifyTypedData({
      address,
      ...typedData,
      signature,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    })
}

async function checkSignature(
  wallet: `0x${string}`,
  typedData: OwnershipTypedData | LegacyOwnershipTypedData,
  signature: `0x${string}`,
  verifyContract: VerifyContractFn,
  blockNumber?: bigint,
): Promise<ProofCheck> {
  try {
    const recovered = await recoverTypedDataAddress({ ...typedData, signature })
    if (recovered.toLowerCase() === wallet.toLowerCase()) return { wallet, status: 'eoa' }
  } catch {
    // Not a plain 65-byte ECDSA signature — a smart-account wrapper, most likely.
    // An EIP-7702 delegated EOA signing with its own key recovers fine above,
    // which is why offline recovery is tried first.
  }
  try {
    const valid = await verifyContract({ address: wallet, typedData, signature, blockNumber })
    return { wallet, status: valid ? 'contract' : 'invalid' }
  } catch (e) {
    return { wallet, status: 'unchecked', reason: e instanceof Error ? e.message : 'signature check unavailable' }
  }
}
```

Add `export type LegacyOwnershipTypedData = ReturnType<typeof legacyOwnershipTypedData>` and widen `VerifyContractSignatureArgs.typedData` to `OwnershipTypedData | LegacyOwnershipTypedData`. `aggregateProofSummary` needs no logic change ('attester' falls through to proved) — keep it as is. Preserve the "'unchecked' is deliberate" comment above `ProofStatus`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/ownership.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ownership.ts test/ownership.test.ts
git commit -m "feat: full-set proof verification with attester exemption; legacy path retained"
```

---

### Task 3: Proof persistence (`proof-store.ts`)

**Files:**
- Create: `src/lib/proof-store.ts`
- Test: `test/proof-store.test.ts`

**Interfaces:**
- Consumes: `canonicalExtraWallets`, `OWNERSHIP_PROOF_TTL_SECONDS` from `@/lib/ownership`.
- Produces (exact, used by Task 8):
  - `interface ProofSession { issuedAt: number; proofs: Record<string, `0x${string}`> }` (keys lowercased)
  - `type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`
  - `proofSessionKey(recipient: `0x${string}`, extras: `0x${string}`[]): string`
  - `loadProofSession(storage: StorageLike, recipient, extras, now: number): ProofSession | null`
  - `getOrCreateProofSession(storage: StorageLike, recipient, extras, now: number): ProofSession`
  - `saveProof(storage: StorageLike, recipient, extras, wallet: `0x${string}`, proof: `0x${string}`, now: number): ProofSession | null` (null when the session lapsed between sign and save)
  - `clearProofSession(storage: StorageLike, recipient, extras): void`

- [ ] **Step 1: Write the failing tests**

Create `test/proof-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  proofSessionKey,
  loadProofSession,
  getOrCreateProofSession,
  saveProof,
  clearProofSession,
} from '@/lib/proof-store'
import { OWNERSHIP_PROOF_TTL_SECONDS } from '@/lib/ownership'

const R = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const A = '0x1563915e194D8CfBA1943570603F7606A3115508' as const
const B = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A' as const
const NOW = 1784975866
const SIG = `0x${'11'.repeat(65)}` as const

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  }
}

describe('proofSessionKey', () => {
  it('is canonical: casing- and order-invariant over the same set', () => {
    expect(proofSessionKey(R, [B, A])).toBe(
      proofSessionKey(R, [A.toLowerCase() as `0x${string}`, B]),
    )
  })

  it('differs when the recipient differs — sets are keyed whole', () => {
    expect(proofSessionKey(R, [A])).not.toBe(proofSessionKey(A, [R]))
  })
})

describe('sessions', () => {
  it('mints once, then returns the same anchor', () => {
    const storage = memoryStorage()
    const first = getOrCreateProofSession(storage, R, [A, B], NOW)
    expect(first).toEqual({ issuedAt: NOW, proofs: {} })
    expect(getOrCreateProofSession(storage, R, [A, B], NOW + 500).issuedAt).toBe(NOW)
  })

  it('stores proofs under lowercased keys and round-trips', () => {
    const storage = memoryStorage()
    getOrCreateProofSession(storage, R, [A, B], NOW)
    const after = saveProof(storage, R, [A, B], A, SIG, NOW + 10)
    expect(after?.proofs[A.toLowerCase()]).toBe(SIG)
    expect(loadProofSession(storage, R, [A, B], NOW + 20)?.proofs[A.toLowerCase()]).toBe(SIG)
  })

  it('expires as a unit: a lapsed session reads as null and is removed', () => {
    const storage = memoryStorage()
    getOrCreateProofSession(storage, R, [A, B], NOW)
    expect(
      loadProofSession(storage, R, [A, B], NOW + OWNERSHIP_PROOF_TTL_SECONDS + 1),
    ).toBeNull()
    expect(storage.map.size).toBe(0)
  })

  it('re-mints a fresh anchor after expiry', () => {
    const storage = memoryStorage()
    getOrCreateProofSession(storage, R, [A, B], NOW)
    const later = NOW + OWNERSHIP_PROOF_TTL_SECONDS + 1
    expect(getOrCreateProofSession(storage, R, [A, B], later).issuedAt).toBe(later)
  })

  it('refuses to save into a lapsed session', () => {
    const storage = memoryStorage()
    getOrCreateProofSession(storage, R, [A, B], NOW)
    expect(saveProof(storage, R, [A, B], A, SIG, NOW + OWNERSHIP_PROOF_TTL_SECONDS + 1)).toBeNull()
  })

  it('treats corrupt or wrong-shape JSON as absent', () => {
    const storage = memoryStorage()
    storage.setItem(proofSessionKey(R, [A]), 'not json')
    expect(loadProofSession(storage, R, [A], NOW)).toBeNull()
    storage.setItem(proofSessionKey(R, [A]), JSON.stringify({ issuedAt: 'x', proofs: [] }))
    expect(loadProofSession(storage, R, [A], NOW)).toBeNull()
  })

  it('clears on demand', () => {
    const storage = memoryStorage()
    getOrCreateProofSession(storage, R, [A], NOW)
    clearProofSession(storage, R, [A])
    expect(loadProofSession(storage, R, [A], NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/proof-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/proof-store.ts`**

```ts
// Signed ownership proofs, persisted per canonical wallet set. Proofs bind
// their own issuedAt (payload v2), not the scan — so surviving reloads and
// re-scans is correct, not stale. The 2026-08-04 argument against persistence
// was a consequence of binding computedAt and dissolves with it.

import { canonicalExtraWallets, OWNERSHIP_PROOF_TTL_SECONDS } from './ownership'

export interface ProofSession {
  issuedAt: number
  /** Keyed by lowercased wallet address. */
  proofs: Record<string, `0x${string}`>
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function proofSessionKey(recipient: `0x${string}`, extras: `0x${string}`[]): string {
  const wallets = [recipient, ...canonicalExtraWallets(recipient, extras)]
  return `obs.proofs.${wallets.map((w) => w.toLowerCase()).join(',')}`
}

export function loadProofSession(
  storage: StorageLike,
  recipient: `0x${string}`,
  extras: `0x${string}`[],
  now: number,
): ProofSession | null {
  const key = proofSessionKey(recipient, extras)
  const raw = storage.getItem(key)
  if (raw === null) return null
  const drop = () => {
    storage.removeItem(key)
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return drop()
  }
  if (typeof parsed !== 'object' || parsed === null) return drop()
  const { issuedAt, proofs } = parsed as { issuedAt?: unknown; proofs?: unknown }
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return drop()
  if (typeof proofs !== 'object' || proofs === null || Array.isArray(proofs)) return drop()
  if (!Object.values(proofs).every((v) => typeof v === 'string' && v.startsWith('0x'))) return drop()
  if (now > issuedAt + OWNERSHIP_PROOF_TTL_SECONDS) return drop()
  return { issuedAt, proofs: proofs as Record<string, `0x${string}`> }
}

export function getOrCreateProofSession(
  storage: StorageLike,
  recipient: `0x${string}`,
  extras: `0x${string}`[],
  now: number,
): ProofSession {
  const existing = loadProofSession(storage, recipient, extras, now)
  if (existing) return existing
  const fresh: ProofSession = { issuedAt: now, proofs: {} }
  storage.setItem(proofSessionKey(recipient, extras), JSON.stringify(fresh))
  return fresh
}

export function saveProof(
  storage: StorageLike,
  recipient: `0x${string}`,
  extras: `0x${string}`[],
  wallet: `0x${string}`,
  proof: `0x${string}`,
  now: number,
): ProofSession | null {
  const session = loadProofSession(storage, recipient, extras, now)
  if (session === null) return null
  const next: ProofSession = {
    issuedAt: session.issuedAt,
    proofs: { ...session.proofs, [wallet.toLowerCase()]: proof },
  }
  storage.setItem(proofSessionKey(recipient, extras), JSON.stringify(next))
  return next
}

export function clearProofSession(
  storage: StorageLike,
  recipient: `0x${string}`,
  extras: `0x${string}`[],
): void {
  storage.removeItem(proofSessionKey(recipient, extras))
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/proof-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/proof-store.ts test/proof-store.test.ts
git commit -m "feat: localStorage proof sessions keyed by canonical wallet set"
```

---

### Task 4: Human wallet errors (`wallet-errors.ts`)

**Files:**
- Create: `src/lib/wallet-errors.ts`
- Test: `test/wallet-errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact, used by Task 8):
  - `type WalletAction = 'connect' | 'switch' | 'sign' | 'attest'`
  - `interface WalletErrorInfo { message: string; detail: string | null; cancelled: boolean }`
  - `describeWalletError(e: unknown, action: WalletAction): WalletErrorInfo`

- [ ] **Step 1: Write the failing tests**

Create `test/wallet-errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeWalletError } from '@/lib/wallet-errors'

describe('describeWalletError', () => {
  it('maps a 4001 rejection to a neutral cancellation, with no technical detail', () => {
    const e = Object.assign(new Error('User rejected the request.'), { code: 4001 })
    expect(describeWalletError(e, 'sign')).toEqual({
      message: 'Cancelled in the wallet.',
      detail: null,
      cancelled: true,
    })
  })

  it('finds the rejection down a wagmi/viem cause chain', () => {
    const inner = Object.assign(new Error('User rejected the request.'), {
      name: 'UserRejectedRequestError',
    })
    const outer = Object.assign(new Error('request failed'), { cause: inner })
    expect(describeWalletError(outer, 'attest').cancelled).toBe(true)
  })

  it('never surfaces a raw revert as the headline', () => {
    const e = new Error('execution reverted: 0xdeadbeef ProviderRpcError blah blah')
    const info = describeWalletError(e, 'attest')
    expect(info.message).toBe('The attestation failed onchain. Nothing was spent besides gas. Try again.')
    expect(info.detail).toContain('execution reverted')
    expect(info.cancelled).toBe(false)
  })

  it('gives the switch action its manual-fallback message', () => {
    expect(describeWalletError(new Error('boom'), 'switch').message).toBe(
      "Couldn't switch to Base Sepolia — switch manually in your wallet and try again.",
    )
  })

  it('handles non-Error throwables', () => {
    const info = describeWalletError('nope', 'connect')
    expect(info.detail).toBeNull()
    expect(info.cancelled).toBe(false)
  })

  it('survives a cyclic cause chain', () => {
    const a: Record<string, unknown> = { message: 'a' }
    a.cause = a
    expect(describeWalletError(a, 'sign').cancelled).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/wallet-errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/wallet-errors.ts`**

```ts
// Raw wallet/RPC errors never reach the UI as a headline. A user rejection is
// not an error at all — it is a decision, rendered neutrally with the action
// left ready to retry. Everything else gets a human sentence, with the raw
// message preserved as collapsible detail for debugging.

export type WalletAction = 'connect' | 'switch' | 'sign' | 'attest'

export interface WalletErrorInfo {
  message: string
  detail: string | null
  cancelled: boolean
}

const FAILURE_MESSAGE: Record<WalletAction, string> = {
  connect: "Couldn't open the wallet connection — try again.",
  switch: "Couldn't switch to Base Sepolia — switch manually in your wallet and try again.",
  sign: "Couldn't get a signature from the wallet — try again.",
  attest: 'The attestation failed onchain. Nothing was spent besides gas. Try again.',
}

// EIP-1193 code 4001 / viem's UserRejectedRequestError, possibly buried in a
// cause chain (wagmi wraps provider errors). Hop cap guards cyclic causes.
function isUserRejection(e: unknown): boolean {
  let current: unknown = e
  for (let hops = 0; hops < 10 && current && typeof current === 'object'; hops++) {
    const { code, name, cause } = current as { code?: unknown; name?: unknown; cause?: unknown }
    if (code === 4001 || name === 'UserRejectedRequestError') return true
    if (cause === current) break
    current = cause
  }
  return false
}

export function describeWalletError(e: unknown, action: WalletAction): WalletErrorInfo {
  if (isUserRejection(e)) {
    return { message: 'Cancelled in the wallet.', detail: null, cancelled: true }
  }
  return {
    message: FAILURE_MESSAGE[action],
    detail: e instanceof Error ? e.message : null,
    cancelled: false,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/wallet-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet-errors.ts test/wallet-errors.test.ts
git commit -m "feat: human wallet-error mapping with cancellation detection"
```

---

### Task 5: Aggregate schema v3 (`eas.ts`)

**Files:**
- Modify: `src/lib/eas.ts`
- Test: `test/eas.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (exact, used by Tasks 6, 8):
  - `ATTEST_AGGREGATE_SCHEMA` — now the v3 string below; `ATTEST_AGGREGATE_SCHEMA_UID` recomputed from it
  - `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA` / `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID` — the old current schema, demoted to decode-only (this is a **rename** of the previous `ATTEST_AGGREGATE_SCHEMA` value)
  - `KNOWN_SCHEMA_UIDS` — now 5 entries
  - `AggregateAttestParams` gains `recipientProof: `0x${string}`` and `proofsIssuedAt: number`
  - `encodeAggregateAttestationData` encodes the two new fields
  - `attestAggregateScore` throws unless exactly one proof slot is `'0x'` and it belongs to the connected account

- [ ] **Step 1: Update `test/eas.test.ts`**

In the `aggregate schema UID` describe:
- The field-list test becomes:

```ts
  it('carries the wallet set, its proofs, the recipient proof slot, and the proof anchor', () => {
    expect(ATTEST_AGGREGATE_SCHEMA).toBe(
      'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,bytes recipient_ownership_proof,uint64 proofs_issued_at,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges',
    )
  })
```

- The golden pin test: replace the pinned UID with `'0x0'` for now (pin the actual in Step 4; the real registration check happens in Task 10).
- The field-order drift test: insert `['recipient_ownership_proof', 'bytes']` and `['proofs_issued_at', 'uint64']` after `['ownership_proofs', 'bytes[]']`.
- Add, in the same describe:

```ts
  it('keeps the demoted verify_url schema pinned — real attestations decode against it', () => {
    expect(ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID).toBe(
      '0x01d83b22aca3881b6673513b0e29fec6659a7def03c69fa41c55a16bcaf192a2',
    )
  })
```

In the `encodeAggregateAttestationData` describe, extend `params` with `recipientProof: '0x' as `0x${string}`, proofsIssuedAt: 1784975866`, update the round-trip expectation to include `'0x'` (recipient proof) and `1784975866n` (anchor) at indices 4 and 5, and add:

```ts
  it('encodes a real recipient proof when an extra is the sender', () => {
    const recipientProof = `0x${'cd'.repeat(65)}` as `0x${string}`
    const data = encodeAggregateAttestationData({
      ...params,
      recipientProof,
      ownershipProofs: ['0x', params.ownershipProofs[1]],
    })
    const decoded = decodeAbiParameters(parseAbiParameters(ATTEST_AGGREGATE_SCHEMA), data)
    expect(decoded[4]).toBe(recipientProof)
    expect(decoded[3]).toEqual(['0x', params.ownershipProofs[1]])
  })
```

Import `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID` at the top.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/eas.test.ts`
Expected: FAIL — schema string mismatch, missing export.

- [ ] **Step 3: Implement in `src/lib/eas.ts`**

1. Rename the current `ATTEST_AGGREGATE_SCHEMA` constant to `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA` and `ATTEST_AGGREGATE_SCHEMA_UID` to `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID`, moving them next to the other legacy schemas with the comment: `// Demoted 2026-08-05: predates the recipient proof slot. Decode-only.`
2. Add the new current schema where the old one sat:

```ts
// v3 (2026-08-05): any wallet of the set may send the attestation. The sender
// needs no stored proof — EAS records it as the attester, which is its proof —
// so exactly one proof slot is '0x': recipient_ownership_proof when the
// recipient sends, or that extra's ownership_proofs slot. proofs_issued_at is
// the shared EIP-712 anchor every signature binds; a forged value makes every
// proof fail recovery, so it cannot be quietly edited.
export const ATTEST_AGGREGATE_SCHEMA =
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,bytes recipient_ownership_proof,uint64 proofs_issued_at,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges'

export const ATTEST_AGGREGATE_SCHEMA_UID = computeSchemaUid(
  ATTEST_AGGREGATE_SCHEMA,
  zeroAddress,
  true,
)
```

3. Append `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID` to `KNOWN_SCHEMA_UIDS` (keep the new `ATTEST_AGGREGATE_SCHEMA_UID` second in the list, after the single-wallet UID).
4. Extend `AggregateAttestParams`:

```ts
export interface AggregateAttestParams extends AttestParams {
  /** Canonical order — canonicalExtraWallets(). Index i pairs with ownershipProofs[i]. */
  extraWallets: `0x${string}`[]
  /** The attester's slot — recipient or extra — holds '0x'. */
  ownershipProofs: `0x${string}`[]
  recipientProof: `0x${string}`
  /** The shared issuedAt anchor every proof binds. */
  proofsIssuedAt: number
  /** Slugs of the badges earned at scan time. Zero-point by construction. */
  badges: string[]
}
```

5. In `encodeAggregateAttestationData`, add after `ownership_proofs`:

```ts
    { name: 'recipient_ownership_proof', value: params.recipientProof, type: 'bytes' },
    { name: 'proofs_issued_at', value: BigInt(params.proofsIssuedAt), type: 'uint64' },
```

(the `Omit<...>` params type picks the new fields up automatically).
6. In `attestAggregateScore`, before building `data`:

```ts
  const account = params.walletClient.account
  if (!account) throw new Error('wallet not connected')
  const slots: Array<[`0x${string}`, `0x${string}`]> = [
    [params.recipient, params.recipientProof],
    ...params.extraWallets.map((w, i): [`0x${string}`, `0x${string}`] => [w, params.ownershipProofs[i]]),
  ]
  const empty = slots.filter(([, proof]) => proof === '0x')
  if (empty.length !== 1 || empty[0][0].toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      'exactly one wallet — the one sending the transaction — may rely on msg.sender as its proof',
    )
  }
```

- [ ] **Step 4: Pin and run**

Pin the new `ATTEST_AGGREGATE_SCHEMA_UID` golden value (see Global Constraints), then:
Run: `npx vitest run test/eas.test.ts && npm test`
Expected: eas tests PASS. `verify.test.ts` may fail on the renamed import — if so, that is Task 6's cycle; only fix compile-level fallout (imports) elsewhere, e.g. `src/lib/verify.ts` referencing the renamed constants: update its imports to add `ATTEST_AGGREGATE_VERIFY_URL_SCHEMA` / `_UID` and keep its existing decode branch pointing at the *renamed* constants so behaviour is unchanged until Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eas.ts src/lib/verify.ts test/eas.test.ts
git commit -m "feat: aggregate schema v3 — recipient proof slot and shared proof anchor"
```

---

### Task 6: Decode + classify v3 (`verify.ts`)

**Files:**
- Modify: `src/lib/verify.ts`
- Test: `test/verify.test.ts`

**Interfaces:**
- Consumes: schema constants from Task 5.
- Produces (exact, used by Task 7):
  - `DecodedScoreAttestation` gains `recipientProof: `0x${string}` | null` and `proofsIssuedAt: number | null` (both `null` for every pre-v3 schema)
  - `isAttesterInSet(att: OnchainAttestation, decoded: DecodedScoreAttestation): boolean`
  - `decodeAttestationData` handles the v3 UID (returns `version: 2`)
  - `isSelfAttested` unchanged (single-wallet display only)

- [ ] **Step 1: Write the failing tests**

In `test/verify.test.ts`, find the existing aggregate encode/decode fixtures (they build data with `encodeAggregateAttestationData` and a fake `OnchainAttestation`). Update every call to `encodeAggregateAttestationData` to include `recipientProof: '0x' as `0x${string}`, proofsIssuedAt: <same number used for computedAt>` — the compiler will point at each. Then add:

```ts
describe('v3 aggregate decode', () => {
  // Build one v3 attestation fixture with the task's encode params and assert:
  it('surfaces the recipient proof and the anchor', () => {
    const decoded = decodeAttestationData(dataV3, ATTEST_AGGREGATE_SCHEMA_UID)
    expect(decoded?.recipientProof).toBe('0x')
    expect(decoded?.proofsIssuedAt).toBe(1784975866)
    expect(decoded?.version).toBe(2)
  })

  it('marks every legacy aggregate decode with a null anchor', () => {
    // Reuse the existing verify_url-schema fixture (now decoding via
    // ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID) and assert:
    expect(decodedLegacy?.recipientProof).toBeNull()
    expect(decodedLegacy?.proofsIssuedAt).toBeNull()
  })
})

describe('isAttesterInSet', () => {
  // att fixtures: minimal OnchainAttestation objects with the attester varied.
  it('accepts the recipient, any extra, and rejects outsiders', () => {
    expect(isAttesterInSet({ ...att, attester: decoded.wallet }, decoded)).toBe(true)
    expect(isAttesterInSet({ ...att, attester: decoded.extraWallets[0] }, decoded)).toBe(true)
    expect(
      isAttesterInSet({ ...att, attester: '0x000000000000000000000000000000000000dEaD' }, decoded),
    ).toBe(false)
  })
})
```

Keep (do not weaken) the existing test asserting an aggregate with garbage proofs still classifies `ok` — the classification/ownership boundary is unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/verify.test.ts`
Expected: FAIL — new fields/functions missing.

- [ ] **Step 3: Implement in `src/lib/verify.ts`**

1. Add to `DecodedScoreAttestation`:

```ts
  /** v3 aggregates: the recipient's proof slot ('0x' when the recipient sent the tx). Null on older schemas. */
  recipientProof: `0x${string}` | null
  /** v3 aggregates: the shared EIP-712 anchor the proofs bind. Null on older schemas — those bound computedAt. */
  proofsIssuedAt: number | null
```

2. Add `const AGGREGATE_VERIFY_URL_SCHEMA_PARAMS = parseAbiParameters(ATTEST_AGGREGATE_VERIFY_URL_SCHEMA)` and a new first aggregate branch in `decodeAttestationData` for the (new) `ATTEST_AGGREGATE_SCHEMA_UID`, destructuring `[specVersion, wallet, extraWallets, ownershipProofs, recipientProof, proofsIssuedAt, githubHandle, score, computedAt, blockNumber, verifyUrl, badges]` and returning `recipientProof`, `proofsIssuedAt: Number(proofsIssuedAt)` alongside the existing fields. The demoted verify_url branch keeps its current body under the renamed UID constant. Every legacy branch (single, verify_url, score_url, prefix) sets `recipientProof: null, proofsIssuedAt: null`.
3. Add:

```ts
// v3 aggregates: the attester needs no stored proof, but only if it is one of
// the attested wallets. An outside attester is tolerated structurally — then
// every wallet must carry a proof, which the ownership display shows.
export function isAttesterInSet(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation,
): boolean {
  try {
    const attester = getAddress(att.attester)
    return [decoded.wallet, ...decoded.extraWallets].some((w) => getAddress(w) === attester)
  } catch {
    return false
  }
}
```

`validateAttestation` / `aggregateStructureProblems` / `classifyAttestation` / `scoreVerdict` are deliberately untouched.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: tests PASS. Typecheck will still fail in `attest-panel.tsx` / `verify/[uid]/page.tsx` (Tasks 7-8) — failures outside those two files must be fixed now (check `src/lib/history.ts`, `src/lib/easscan.ts`, `src/lib/percentile.ts`: they consume `KNOWN_SCHEMA_UIDS`/`decodeAttestationData`, which are additive changes, so expect no edits — verify, don't assume).

- [ ] **Step 5: Commit**

```bash
git add src/lib/verify.ts test/verify.test.ts
git commit -m "feat: decode aggregate schema v3, attester-in-set check"
```

---

### Task 7: Verify page — v3 ownership display

**Files:**
- Modify: `src/app/verify/[uid]/page.tsx` (OWNERSHIP_COPY at 74-87, attester row at 145-159, ownership call at 316-325, ownership rows at 160-178)

**Interfaces:**
- Consumes: `verifyOwnershipProofs` (v2 args), `verifyLegacyOwnershipProofs`, `isAttesterInSet`, `decoded.recipientProof` / `decoded.proofsIssuedAt`.
- Produces: display only.

- [ ] **Step 1: Update the ownership check call**

Replace the ownership block (lines 316-325):

```ts
        const ownership =
          classification.decoded.extraWallets.length > 0
            ? classification.decoded.proofsIssuedAt !== null
              ? await verifyOwnershipProofs({
                  recipient: classification.decoded.wallet,
                  extras: classification.decoded.extraWallets,
                  proofs: classification.decoded.ownershipProofs,
                  recipientProof: classification.decoded.recipientProof ?? '0x',
                  attester: fetched.attestation.attester as `0x${string}`,
                  issuedAt: classification.decoded.proofsIssuedAt,
                  at: fetched.attestation.timeCreated,
                })
              : await verifyLegacyOwnershipProofs({
                  primary: classification.decoded.wallet,
                  extras: classification.decoded.extraWallets,
                  proofs: classification.decoded.ownershipProofs,
                  computedAt: classification.decoded.computedAt,
                  at: fetched.attestation.timeCreated,
                })
            : []
```

Update imports accordingly. Note the v3 path returns one more row (the recipient leads) — the row renderer already maps over `ownership`, so no change there.

- [ ] **Step 2: Extend OWNERSHIP_COPY and the attester row**

Add to `OWNERSHIP_COPY`:

```ts
  // msg.sender: EAS itself recorded this wallet as the attester. Free, onchain,
  // and as permanent as the attestation.
  attester: { tone: 'text-success-text', text: '✓ proved by sending this attestation' },
```

and change the `expired` text to `'⚠ signed outside the proofs’ validity window'` (the window is the signatures' own now, not the scan's).

Replace the attester row annotation (lines 149-157) with an aggregate/single split:

```tsx
          {decoded.extraWallets.length > 0 ? (
            isAttesterInSet(attestation, decoded) ? (
              <span className="block font-sans text-xs text-success-text">
                ✓ In the wallet set — proved by sending this attestation
              </span>
            ) : (
              <span className="block font-sans text-xs text-warning-text">
                ⚠ Outside the wallet set — every wallet must carry its own signature
              </span>
            )
          ) : isSelfAttested(attestation, decoded) ? (
            <span className="block font-sans text-xs text-success-text">
              ✓ Self-attested — the scored wallet signed this itself
            </span>
          ) : (
            <span className="block font-sans text-xs text-warning-text">
              ⚠ Not the scored wallet — someone else attested this score
            </span>
          )}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — no errors may remain in this file (attest-panel errors remain until Task 8). Run `npm test`.
Then `npm run dev` and open an existing verify URL (any single-wallet attestation UID from Base Sepolia easscan) to confirm the page still renders.

- [ ] **Step 4: Commit**

```bash
git add "src/app/verify/[uid]/page.tsx"
git commit -m "feat: verify page shows attester-exempt ownership for v3 aggregates"
```

---

### Task 8: Attest panel — ownership checklist

**Files:**
- Modify: `src/components/attest-panel.tsx` (full rework of the aggregate path)

**Interfaces:**
- Consumes: everything from Tasks 1-5 (`ownershipTypedData` v2, `verifyOwnershipProofs` v2, proof-store, wallet-errors, `attestAggregateScore` with `recipientProof`/`proofsIssuedAt`).
- Produces: UI only. Single-wallet path behaviour unchanged except error rendering.

- [ ] **Step 1: Rework state and gates**

Key mechanics (implement within the existing component structure — one return, `ConnectButton` always mounted):

```ts
  const recipient = scored.address
  const extras = canonicalExtraWallets(recipient, scored.extraAddresses)
  const rows = [recipient, ...extras]
  const isAggregate = extras.length > 0

  // Loaded in an effect: localStorage is browser-only and this component SSRs.
  const [session, setSession] = useState<ProofSession | null>(null)
  useEffect(() => {
    if (!isAggregate) return
    setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
    // Canonical set is derived state; key it by its serialisation.
  }, [isAggregate, recipient, extras.join(',')])

  const proofFor = (w: string) => session?.proofs[w.toLowerCase()]
  const connectedLower = connected?.toLowerCase()
  const connectedInSet = rows.some((w) => w.toLowerCase() === connectedLower)
  // Every wallet except the connected one must hold a signature; the connected
  // one proves itself by sending the transaction.
  const missingOthers = rows.filter(
    (w) => w.toLowerCase() !== connectedLower && proofFor(w) === undefined,
  )
  const setProved = connectedInSet && missingOthers.length === 0

  const [error, setError] = useState<WalletErrorInfo | null>(null)

  const canAttest = isAggregate
    ? dataComplete && handleVerified && onAttestChain && setProved && session !== null
    : dataComplete && handleVerified && onAttestChain && walletOwned
```

`walletOwned` stays for the single path only. Every `setError(e instanceof Error ? e.message : '…')` site becomes `setError(describeWalletError(e, '<action>'))`; the two signature-check messages ("doesn't verify as…", "Couldn't confirm…") become `setError({ message: <current text>, detail: null, cancelled: false })`.

- [ ] **Step 2: Signing — always against the full set, auto-prompted on connect**

```ts
  async function handleSign(wallet: `0x${string}`) {
    if (signing || busy || session === null) return
    setSigning(wallet.toLowerCase())
    setError(null)
    try {
      const typedData = ownershipTypedData({ recipient, wallet, extras, issuedAt: session.issuedAt })
      const signature = await signTypedDataAsync(typedData)

      // Verify inside the full set before storing (a wallet signing from a
      // different account than displayed would otherwise surface after gas was
      // spent). The old preflight verified against a one-wallet set — with two
      // or more extras every signature "failed". This one cannot: the check
      // rebuilds exactly what was signed.
      const idx = rows.findIndex((w) => w.toLowerCase() === wallet.toLowerCase())
      const checks = await verifyOwnershipProofs({
        recipient,
        extras,
        proofs: extras.map((w) => (w.toLowerCase() === wallet.toLowerCase() ? signature : '0x')),
        recipientProof: wallet.toLowerCase() === recipient.toLowerCase() ? signature : '0x',
        attester: null,
        issuedAt: session.issuedAt,
        at: Math.floor(Date.now() / 1000),
      })
      const check = checks[idx]
      if (check.status === 'invalid' || check.status === 'missing') {
        setError({
          message: `That signature doesn't verify as ${short(wallet)}. Check which account your wallet signed with.`,
          detail: null,
          cancelled: false,
        })
        return
      }
      if (check.status === 'unchecked') {
        setError({
          message: `Couldn't confirm the signature right now (${check.reason}). Try again.`,
          detail: null,
          cancelled: false,
        })
        return
      }
      if (check.status === 'expired') {
        setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
        setError({ message: 'These signatures expired — a fresh window was started, sign again.', detail: null, cancelled: false })
        return
      }
      const next = saveProof(localStorage, recipient, extras, wallet, signature, Math.floor(Date.now() / 1000))
      if (next) setSession(next)
    } catch (e) {
      setError(describeWalletError(e, 'sign'))
    } finally {
      setSigning(null)
    }
  }

  // Auto-prompt: a freshly connected wallet that matches a pending row signs
  // immediately — unless it is the only unproven one, in which case it needs
  // nothing: it will prove itself by sending the transaction.
  const prevConnected = useRef<string | undefined>(undefined)
  useEffect(() => {
    const changed = connectedLower !== prevConnected.current
    prevConnected.current = connectedLower
    if (!changed || !isAggregate || !connectedLower || session === null) return
    if (!onAttestChain || signing || busy) return
    const mine = rows.find((w) => w.toLowerCase() === connectedLower)
    if (!mine || proofFor(mine)) return
    const othersPending = rows.some(
      (w) => w.toLowerCase() !== connectedLower && proofFor(w) === undefined,
    )
    if (!othersPending) return
    void handleSign(mine)
  }, [connectedLower, onAttestChain, session, isAggregate])
```

- [ ] **Step 3: Attest with the connected wallet's slot empty**

In `handleAttest`, the expiry check and aggregate branch become:

```ts
    if (isAggregate) {
      if (session === null) return
      if (Math.floor(Date.now() / 1000) > session.issuedAt + OWNERSHIP_PROOF_TTL_SECONDS) {
        clearProofSession(localStorage, recipient, extras)
        setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
        setError({ message: 'These signatures expired — sign again to attest.', detail: null, cancelled: false })
        return
      }
    }
```

and in the `attestAggregateScore` call (attester slot emptied even when a proof exists — the tx sender's proof is `msg.sender`):

```ts
            extraWallets: extras,
            ownershipProofs: extras.map((w) =>
              w.toLowerCase() === connectedLower ? '0x' : session!.proofs[w.toLowerCase()],
            ),
            recipientProof:
              recipient.toLowerCase() === connectedLower ? '0x' : session!.proofs[recipient.toLowerCase()],
            proofsIssuedAt: session!.issuedAt,
```

- [ ] **Step 4: Checklist rendering**

Replace the extras-only "Wallet ownership" list with a full-set checklist (recipient row included) plus explainer, and replace the `walletOwned` warning block with an in-set version. Structure:

```tsx
      {isAggregate && dataComplete && handleVerified && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background/40 p-3">
          <h3 className="text-sm font-medium">Prove ownership</h3>
          <p className="text-sm text-muted-foreground">
            Each wallet proves ownership once: the one that sends the transaction proves itself;
            the rest sign a free message.
          </p>
          {!onAttestChain && connected && (
            <p className="text-sm text-warning-text">
              Switch to Base Sepolia first — a wallet won&apos;t sign a message for a network it
              isn&apos;t on.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((wallet) => {
              const lower = wallet.toLowerCase()
              const signed = proofFor(wallet) !== undefined
              const isConnected = lower === connectedLower
              const isRecipient = lower === recipient.toLowerCase()
              const proved = signed || isConnected
              return (
                <li key={wallet} className="flex flex-wrap items-center gap-2 text-sm">
                  <PingDot settled={proved} />
                  <span className="break-all font-mono">{wallet}</span>
                  {isRecipient && (
                    <span className="text-xs text-muted-foreground">score address</span>
                  )}
                  {isConnected ? (
                    <span className="text-success-text">
                      ✓ proves itself by sending the transaction
                    </span>
                  ) : signed ? (
                    <span className="text-success-text">✓ signed</span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleConnectAs}
                        disabled={signing !== null || busy || !openConnectModal}
                      >
                        Connect &amp; sign
                      </Button>
                      <span className="text-muted-foreground">
                        disconnects the current wallet, then pick this address — the signature
                        request follows on its own.
                      </span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {session !== null && (
            <p className="text-xs text-muted-foreground">
              Signatures are valid until{' '}
              {new Date((session.issuedAt + OWNERSHIP_PROOF_TTL_SECONDS) * 1000).toLocaleString()}{' '}
              and survive page reloads.{' '}
              <Link
                href={scorePath(recipient, scored.githubHandle)}
                className="underline hover:text-foreground"
              >
                Score this address alone
              </Link>{' '}
              to attest without extra signatures.
            </p>
          )}
        </div>
      )}

      {connected && !onAttestChain && null /* switch button already in the button row */}

      {isAggregate
        ? connected &&
          !connectedInSet && (
            <p className="text-sm text-warning-text">
              You&apos;re connected as <span className="font-mono break-all">{connected}</span>,
              which isn&apos;t one of the scored wallets. Connect any wallet from the list above —
              whichever is connected when you attest is the one that sends the transaction.
            </p>
          )
        : connected &&
          !walletOwned && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-warning-text">
                You&apos;re connected as <span className="font-mono break-all">{connected}</span>,
                but this score is for{' '}
                <span className="font-mono break-all">{scored.address}</span>. Connect the scored
                wallet to attest it — an attestation only means something if the wallet signs for
                itself.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleConnectAs}
                disabled={signing !== null || busy || !openConnectModal}
              >
                Connect the scored wallet
              </Button>
            </div>
          )}
```

Notes: the old "Sign with this wallet" per-row button disappears — the connected wallet never signs manually (auto-prompt covers the connect moment; if the user dismissed it, switching away and back re-triggers, and a signed-or-sender state is always green). Wait — a dismissed auto-prompt with no manual fallback is a dead end when the user stays on that wallet. Add one fallback affordance: when `isConnected && !signed && missingOthers.length > 0` render a small `Sign with this wallet` button (calls `handleSign(wallet)`) *instead of* the plain "proves itself" label, with the label text `will send the transaction — or sign so any other wallet can`. Exactly one of the two states renders per row; no dead ends.

The old footer paragraph ("Signatures are tied to this scan…") is deleted — its replacement lives inside the checklist box. The header explainer sentence at the top of the panel (lines 200-205) keeps its first sentence and drops the "Each other wallet signs once…" tail (the checklist explains it now).

- [ ] **Step 5: Error rendering**

Replace `{error && <p …>{error}</p>}` with:

```tsx
      {error && (
        <div className={`text-sm ${error.cancelled ? 'text-muted-foreground' : 'text-destructive-text'}`}>
          <p>{error.message}</p>
          {error.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Technical detail
              </summary>
              <p className="break-all font-mono text-xs text-muted-foreground">{error.detail}</p>
            </details>
          )}
        </div>
      )}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test` — all green, repo-wide.
Then `npm run dev`, open a multi-wallet score (`/score/<addr>?extras=…` — check `src/lib/routes.ts` `scorePath`/`inputPath` for the exact query shape), and verify manually: checklist renders all wallets with the recipient marked "score address"; connecting a set wallet auto-prompts a signature when another wallet is still pending; a signed row survives a reload; the attest button is disabled with pending rows visible on screen; rejecting the signature shows "Cancelled in the wallet." in muted styling.

- [ ] **Step 7: Commit**

```bash
git add src/components/attest-panel.tsx
git commit -m "feat: ownership checklist — any set wallet attests, proofs persist, human errors"
```

---

### Task 9: Copy sweep — "primary" dies

**Files:**
- Modify: `src/app/score/page.tsx` (internal names only — labels never said "primary")
- Modify: `README.md` (Ground rules + aggregate design sections)
- Modify: `src/lib/orchestrate.ts:111` (comment only)

- [ ] **Step 1: Rename internals in `score/page.tsx`**

`primary` → `recipient` (line 73), `primaryAddress` → `recipientAddress` (lines 85-94). Behaviour untouched.

- [ ] **Step 2: Rewrite README "Ground rules" and payload docs**

In `README.md`: the ground-rules bullet (around line 449 in the pre-plan file, grep for "attesting requires the connected wallet") becomes:

> Attesting an aggregate requires every wallet in the set to be proven: the wallet that sends the transaction is proven by `msg.sender` — EAS records it as the attester — and each of the others by an EIP-712 signature stored inside the attestation. Any wallet of the set may be the sender. The first wallet is simply the address the score is issued to (the EAS recipient, where lookups find it); it has no signing privilege.

Update the schema/payload lines (grep `primary` — lines ~222, 257-258, 266, 274): `wallet` field is "the recipient"; the message line becomes `message WalletOwnership { statement, wallet, recipient, wallets[], issuedAt, expiresAt }`; the no-nonce bullet says "`recipient` and the whole wallet set are bound". Fix `orchestrate.ts:111` comment: "The as-of anchor stays the recipient wallet's."

- [ ] **Step 3: Sweep check**

Run: `grep -rn "primary" src/ README.md --include='*.ts' --include='*.tsx' --include='*.md' | grep -iv 'primaryType'`
Expected: no user-facing or identifier hits left (EIP-712's `primaryType` is protocol vocabulary and stays; `legacyOwnershipTypedData`'s `primary` field and `LegacyOwnershipMessageArgs`/`verifyLegacyOwnershipProofs` args are frozen protocol history and stay — everything else goes).

Run: `npm run typecheck && npm test`

- [ ] **Step 4: Commit**

```bash
git add src/app/score/page.tsx src/lib/orchestrate.ts README.md
git commit -m "chore: retire 'primary' — recipient naming everywhere current"
```

---

### Task 10: Register schema v3 on Base Sepolia

**Files:**
- Run: `scripts/register-aggregate-schema.mjs` (reads the schema string out of `src/lib/eas.ts` — no edits expected; verify it imports/parses the *current* `ATTEST_AGGREGATE_SCHEMA` constant and adjust its extraction if it greps the old declaration shape)
- Run: `scripts/set-schema-metadata.mjs`
- Modify: `src/lib/eas.ts` (registration note comment), `test/eas.test.ts` (confirm pin)

- [ ] **Step 1: Preflight** — `node --env-file=.env scripts/register-aggregate-schema.mjs` (requires `ATTESTATION_WALLET_KEY` in `.env`; the script is idempotent and refuses on UID mismatch). Confirm the printed UID equals the Task 5 pin.
- [ ] **Step 2: Register** — `node --env-file=.env scripts/register-aggregate-schema.mjs --send`. Record the schema number and tx hash from the `Registered` event in a comment above `ATTEST_AGGREGATE_SCHEMA` (follow the existing "Registered on Base Sepolia (2026-08-04)" convention).
- [ ] **Step 3: Metadata** — `node --env-file=.env scripts/set-schema-metadata.mjs` (name/description for the new schema; check the script's target list includes the new UID and update it if it pins UIDs).
- [ ] **Step 4: Verify** — open the schema on `https://base-sepolia.easscan.org`, confirm the field list renders and the UID matches. Run `npm test`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/eas.ts test/eas.test.ts scripts/
git commit -m "chore: register aggregate schema v3 on Base Sepolia"
```

---

### Task 11: End-to-end pass on Base Sepolia (manual)

No file changes expected; fixes found here become follow-up commits.

- [ ] **Step 1:** Score a real 3-wallet set (recipient + 2 extras — two extras is the regression case for the old preflight bug). Include the 7702 delegated EOA (`0x33041027…` or `0xc8B74c37…`) as an extra, per the 2026-08-04 spec's Remaining note.
- [ ] **Step 2:** Connect wallet 1 → expect auto signature prompt (others pending) → sign. Switch to wallet 2 → auto prompt → sign. Switch to wallet 3 (an **extra**, not the recipient) → no prompt (sole unproven) → Attest onchain.
- [ ] **Step 3:** Mid-flow, reload the page after the first signature — the checklist must show it still signed.
- [ ] **Step 4:** Reject one signature request — expect muted "Cancelled in the wallet.", button ready again.
- [ ] **Step 5:** Open the resulting attestation in `/verify/<uid>` — expect: score recomputes to `match`; ownership rows `[recipient: ✓ signature, extra1: ✓ signature, extra2: ✓ proved by sending this attestation]`; attester line "✓ In the wallet set".
- [ ] **Step 6:** If a smart-account wallet (wrapped signature) is available, repeat with it as an extra to exercise the `contract` path end-to-end.
- [ ] **Step 7:** Attest a single-wallet score to confirm that path is untouched.
