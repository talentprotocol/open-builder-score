import { describe, it, expect } from 'vitest'
import { hashTypedData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  canonicalExtraWallets,
  ownershipTypedData,
  legacyOwnershipTypedData,
  verifyOwnershipProofs,
  verifyLegacyOwnershipProofs,
  aggregateProofSummary,
  OWNERSHIP_PROOF_TTL_SECONDS,
  ISSUED_AT_SKEW_ALLOWANCE_SECONDS,
} from '@/lib/ownership'

const PRIMARY = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const
const A = '0x1563915e194D8CfBA1943570603F7606A3115508' as const
const B = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A' as const

describe('canonicalExtraWallets', () => {
  it('sorts ascending by address, independent of input order', () => {
    expect(canonicalExtraWallets(PRIMARY, [B, A])).toEqual([A, B])
    expect(canonicalExtraWallets(PRIMARY, [A, B])).toEqual([A, B])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(canonicalExtraWallets(PRIMARY, [A, A.toLowerCase() as `0x${string}`])).toEqual([A])
  })

  it('drops the recipient — it is part of the set, not an extra', () => {
    expect(canonicalExtraWallets(PRIMARY, [A, PRIMARY.toLowerCase() as `0x${string}`])).toEqual([A])
  })
})

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
    expect(digest({ ...base, chainId: 84532 })).not.toBe(baseline)
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

const signerA = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const signerB = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const EXTRAS = canonicalExtraWallets(PRIMARY, [signerA.address, signerB.address])

// Never called in these tests: every signer is an EOA, so recovery is offline.
const failIfCalled = async () => {
  throw new Error('contract verification must not be reached for EOA signatures')
}

const statuses = (checks: Awaited<ReturnType<typeof verifyOwnershipProofs>>) =>
  checks.map((c) => c.status)

const signerFor = (address: `0x${string}`) => (address === signerA.address ? signerA : signerB)

const RECIPIENT = PRIMARY

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
    // issuedAt well before the attestation landed — beyond any plausible
    // client clock skew — proofs cannot postdate the record by an unbounded
    // margin. (The boundary at the skew allowance itself is covered below.)
    const early = await verifyOwnershipProofs(
      {
        ...base,
        proofs,
        recipientProof: '0x',
        attester: RECIPIENT,
        at: ISSUED_AT - ISSUED_AT_SKEW_ALLOWANCE_SECONDS - 3600,
      },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(early)).toEqual(['attester', 'expired', 'expired'])
  })

  it('tolerates a client clock behind the chain clock by up to the skew allowance', async () => {
    // at == issuedAt - 599: one second inside the 600s allowance — valid.
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const checks = await verifyOwnershipProofs(
      {
        ...base,
        proofs,
        recipientProof: '0x',
        attester: RECIPIENT,
        at: ISSUED_AT - (ISSUED_AT_SKEW_ALLOWANCE_SECONDS - 1),
      },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['attester', 'eoa', 'eoa'])
  })

  it('expires once the clock skew exceeds the allowance', async () => {
    // at == issuedAt - 601: one second past the 600s allowance — expired.
    const proofs = await Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))
    const checks = await verifyOwnershipProofs(
      {
        ...base,
        proofs,
        recipientProof: '0x',
        attester: RECIPIENT,
        at: ISSUED_AT - (ISSUED_AT_SKEW_ALLOWANCE_SECONDS + 1),
      },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['attester', 'expired', 'expired'])
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

describe('legacyOwnershipTypedData golden vector', () => {
  // The v1 pin, unchanged: old attestations must keep verifying forever. Every
  // v1 proof was signed on Base Sepolia, so the domain is pinned to 84532
  // explicitly — the app's default moved to Base mainnet on 2026-08-18.
  it('hashes the fixed v1 tuple to the original pinned digest', () => {
    expect(
      hashTypedData(
        legacyOwnershipTypedData({
          primary: PRIMARY,
          wallet: EXTRAS[0],
          extras: EXTRAS,
          computedAt: ISSUED_AT,
          chainId: 84532,
        }),
      ),
    ).toBe('0xdc72c7e691a7d9f139bf4f3df6c220a2ca687119b6f99e51fd1c7fbbc2976a3c')
  })
})

describe('ownershipTypedData golden vector', () => {
  // Regenerate only when the proof format changes deliberately — and when it
  // does, the schema UID must change with it, because old proofs stop verifying.
  // Re-pinned 2026-08-18 for the Base mainnet domain (chainId 8453); the prior
  // pin (0xe7ed6c8c…) was the same tuple under Base Sepolia's 84532.
  it('hashes a fixed tuple to a pinned digest', () => {
    expect(
      digest({ recipient: PRIMARY, wallet: EXTRAS[0], extras: EXTRAS, issuedAt: ISSUED_AT }),
    ).toBe('0x2d33b35121064e64a83233c7f8933b8a886cc437ae66c9c7423ff4aab41b0a47')
  })
})

describe('verifyOwnershipProofs — non-EOA and failure paths', () => {
  const base = { recipient: RECIPIENT, extras: EXTRAS, issuedAt: ISSUED_AT, recipientProof: '0x' as const, attester: RECIPIENT }
  const signAllInOrder = () => Promise.all(EXTRAS.map((a) => signV2(signerFor(a), a)))

  it('reports expired without spending a network call', async () => {
    const proofs = await signAllInOrder()
    const checks = await verifyOwnershipProofs(
      { ...base, proofs, at: ISSUED_AT + OWNERSHIP_PROOF_TTL_SECONDS + 1 },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['attester', 'expired', 'expired'])
  })

  it('reports missing for an absent or empty proof', async () => {
    const proofs = await signAllInOrder()
    const checks = await verifyOwnershipProofs(
      { ...base, proofs: ['0x', proofs[1]], at: ISSUED_AT + 60 },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(checks)).toEqual(['attester', 'missing', 'eoa'])

    const short = await verifyOwnershipProofs(
      { ...base, proofs: [proofs[0]], at: ISSUED_AT + 60 },
      { verifyContractSignature: failIfCalled },
    )
    expect(statuses(short)).toEqual(['attester', 'eoa', 'missing'])
  })

  it('falls back to the account contract when offline recovery does not match', async () => {
    const wrapper = `0x${'ab'.repeat(200)}` as const
    const seen: unknown[] = []
    const checks = await verifyOwnershipProofs(
      { ...base, proofs: [wrapper, wrapper], at: ISSUED_AT + 60, blockNumber: 42n },
      {
        verifyContractSignature: async (a) => {
          seen.push(a)
          return true
        },
      },
    )
    expect(statuses(checks)).toEqual(['attester', 'contract', 'contract'])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ address: EXTRAS[0], signature: wrapper, blockNumber: 42n })
  })

  it('reports invalid when the account contract rejects the signature', async () => {
    const wrapper = `0x${'ab'.repeat(200)}` as const
    const checks = await verifyOwnershipProofs(
      { ...base, proofs: [wrapper, wrapper], at: ISSUED_AT + 60 },
      { verifyContractSignature: async () => false },
    )
    expect(statuses(checks)).toEqual(['attester', 'invalid', 'invalid'])
  })

  it('reports unchecked — not invalid — when the RPC fails, preserving the reason', async () => {
    const wrapper = `0x${'ab'.repeat(200)}` as const
    const checks = await verifyOwnershipProofs(
      { ...base, proofs: [wrapper, wrapper], at: ISSUED_AT + 60 },
      {
        verifyContractSignature: async () => {
          throw new Error('base-sepolia unreachable')
        },
      },
    )
    expect(statuses(checks)).toEqual(['attester', 'unchecked', 'unchecked'])
    expect(checks[1].reason).toBe('base-sepolia unreachable')
  })
})

describe('verifyLegacyOwnershipProofs', () => {
  // Never called in these tests: every signer is an EOA, so recovery is offline.
  const failIfCalledLegacy = async () => {
    throw new Error('contract verification must not be reached for EOA signatures')
  }

  function signLegacy(
    signer: typeof signerA,
    over: { primary?: `0x${string}`; extras?: `0x${string}`[] } = {},
  ) {
    return signer.signTypedData(
      legacyOwnershipTypedData({
        primary: over.primary ?? PRIMARY,
        wallet: signer.address,
        extras: over.extras ?? EXTRAS,
        computedAt: ISSUED_AT,
      }),
    )
  }

  it('accepts an EOA signature offline, with no network call', async () => {
    const proofs = await Promise.all(EXTRAS.map((a) => signLegacy(signerFor(a))))
    const checks = await verifyLegacyOwnershipProofs(
      { primary: PRIMARY, extras: EXTRAS, proofs, computedAt: ISSUED_AT, at: ISSUED_AT + 60 },
      { verifyContractSignature: failIfCalledLegacy },
    )
    expect(statuses(checks)).toEqual(['eoa', 'eoa'])
  })

  it('rejects a proof signed for a different primary — the whale-borrowing defence', async () => {
    const OTHER = '0x000000000000000000000000000000000000dEaD' as const
    const proofs = await Promise.all(
      EXTRAS.map((a) => signLegacy(signerFor(a), { primary: OTHER })),
    )
    const checks = await verifyLegacyOwnershipProofs(
      { primary: PRIMARY, extras: EXTRAS, proofs, computedAt: ISSUED_AT, at: ISSUED_AT + 60 },
      { verifyContractSignature: async () => false },
    )
    expect(statuses(checks)).toEqual(['invalid', 'invalid'])
  })
})

describe('aggregateProofSummary', () => {
  const w = EXTRAS[0]

  it('is all_proved only when every proof stands on its own', () => {
    expect(aggregateProofSummary([{ wallet: w, status: 'eoa' }])).toBe('all_proved')
    expect(
      aggregateProofSummary([
        { wallet: w, status: 'eoa' },
        { wallet: w, status: 'contract' },
      ]),
    ).toBe('all_proved')
  })

  it('ranks a failure above an unchecked proof', () => {
    expect(
      aggregateProofSummary([
        { wallet: w, status: 'unchecked' },
        { wallet: w, status: 'invalid' },
      ]),
    ).toBe('failed')
  })

  it('reports some_unchecked when nothing failed but something could not be checked', () => {
    expect(
      aggregateProofSummary([
        { wallet: w, status: 'eoa' },
        { wallet: w, status: 'unchecked' },
      ]),
    ).toBe('some_unchecked')
  })

  it('counts an attester-exempt slot as proved', () => {
    expect(
      aggregateProofSummary([
        { wallet: w, status: 'attester' },
        { wallet: w, status: 'eoa' },
      ]),
    ).toBe('all_proved')
  })
})
