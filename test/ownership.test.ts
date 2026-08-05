import { describe, it, expect } from 'vitest'
import { hashTypedData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  canonicalExtraWallets,
  ownershipTypedData,
  legacyOwnershipTypedData,
  verifyOwnershipProofs,
  aggregateProofSummary,
  OWNERSHIP_PROOF_TTL_SECONDS,
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

const signerA = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const signerB = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const EXTRAS = canonicalExtraWallets(PRIMARY, [signerA.address, signerB.address])

// Task 2 rewrites these — verifyOwnershipProofs and its helpers below still
// assume the v1 payload shape (primary/computedAt). Left commented rather
// than adapted so the compile errors don't leak into a "temporarily working"
// v1/v2 hybrid; Task 2 replaces this block wholesale.
// // Never called in these tests: every signer is an EOA, so recovery is offline.
// const failIfCalled = async () => {
//   throw new Error('contract verification must not be reached for EOA signatures')
// }
//
// function sign(
//   signer: typeof signerA,
//   over: { primary?: `0x${string}`; extras?: `0x${string}`[] } = {},
// ) {
//   return signer.signTypedData(
//     ownershipTypedData({
//       primary: over.primary ?? PRIMARY,
//       wallet: signer.address,
//       extras: over.extras ?? EXTRAS,
//       computedAt: ISSUED_AT,
//     }),
//   )
// }
//
// const statuses = (checks: Awaited<ReturnType<typeof verifyOwnershipProofs>>) =>
//   checks.map((c) => c.status)
//
// const signerFor = (address: `0x${string}`) => (address === signerA.address ? signerA : signerB)
//
// /** Proofs aligned to EXTRAS order, which is sorted and so not the declaration order. */
// const signAllInOrder = (over: { primary?: `0x${string}` } = {}) =>
//   Promise.all(EXTRAS.map((a) => sign(signerFor(a), over)))
//
// describe('verifyOwnershipProofs', () => {
//   it('accepts an EOA signature offline, with no network call', async () => {
//     const proofs = await Promise.all(EXTRAS.map((a) => sign(a === signerA.address ? signerA : signerB)))
//     const checks = await verifyOwnershipProofs(
//       { primary: PRIMARY, extras: EXTRAS, proofs, computedAt: ISSUED_AT, at: ISSUED_AT + 60 },
//       { verifyContractSignature: failIfCalled },
//     )
//     expect(statuses(checks)).toEqual(['eoa', 'eoa'])
//   })
//
//   it('rejects a proof signed for a different primary — the whale-borrowing defence', async () => {
//     const OTHER = '0x000000000000000000000000000000000000dEaD' as const
//     const proofs = await Promise.all(
//       EXTRAS.map((a) => sign(a === signerA.address ? signerA : signerB, { primary: OTHER })),
//     )
//     const checks = await verifyOwnershipProofs(
//       { primary: PRIMARY, extras: EXTRAS, proofs, computedAt: ISSUED_AT, at: ISSUED_AT + 60 },
//       { verifyContractSignature: async () => false },
//     )
//     expect(statuses(checks)).toEqual(['invalid', 'invalid'])
//   })
//
//   it('rejects two valid proofs swapped between indices', async () => {
//     const proofs = await signAllInOrder()
//     const checks = await verifyOwnershipProofs(
//       {
//         primary: PRIMARY,
//         extras: EXTRAS,
//         proofs: [proofs[1], proofs[0]],
//         computedAt: ISSUED_AT,
//         at: ISSUED_AT + 60,
//       },
//       { verifyContractSignature: async () => false },
//     )
//     expect(statuses(checks)).toEqual(['invalid', 'invalid'])
//   })
// })

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
    ).toBe('0xe7ed6c8c537dab5a75fa2f3613404cfb947bf57d7702e324b8edcc904e6db25f')
  })
})

// Task 2 rewrites these
// describe('verifyOwnershipProofs — non-EOA and failure paths', () => {
//   const base = { primary: PRIMARY, extras: EXTRAS, computedAt: ISSUED_AT }
//
//   it('reports expired without spending a network call', async () => {
//     const proofs = await signAllInOrder()
//     const checks = await verifyOwnershipProofs(
//       { ...base, proofs, at: ISSUED_AT + OWNERSHIP_PROOF_TTL_SECONDS + 1 },
//       { verifyContractSignature: failIfCalled },
//     )
//     expect(statuses(checks)).toEqual(['expired', 'expired'])
//   })
//
//   it('reports missing for an absent or empty proof', async () => {
//     const proofs = await signAllInOrder()
//     const checks = await verifyOwnershipProofs(
//       { ...base, proofs: ['0x', proofs[1]], at: ISSUED_AT + 60 },
//       { verifyContractSignature: failIfCalled },
//     )
//     expect(statuses(checks)).toEqual(['missing', 'eoa'])
//
//     const short = await verifyOwnershipProofs(
//       { ...base, proofs: [proofs[0]], at: ISSUED_AT + 60 },
//       { verifyContractSignature: failIfCalled },
//     )
//     expect(statuses(short)).toEqual(['eoa', 'missing'])
//   })
//
//   it('falls back to the account contract when offline recovery does not match', async () => {
//     const wrapper = `0x${'ab'.repeat(200)}` as const
//     const seen: unknown[] = []
//     const checks = await verifyOwnershipProofs(
//       { ...base, proofs: [wrapper, wrapper], at: ISSUED_AT + 60, blockNumber: 42n },
//       {
//         verifyContractSignature: async (a) => {
//           seen.push(a)
//           return true
//         },
//       },
//     )
//     expect(statuses(checks)).toEqual(['contract', 'contract'])
//     expect(seen).toHaveLength(2)
//     expect(seen[0]).toMatchObject({ address: EXTRAS[0], signature: wrapper, blockNumber: 42n })
//   })
//
//   it('reports invalid when the account contract rejects the signature', async () => {
//     const wrapper = `0x${'ab'.repeat(200)}` as const
//     const checks = await verifyOwnershipProofs(
//       { ...base, proofs: [wrapper, wrapper], at: ISSUED_AT + 60 },
//       { verifyContractSignature: async () => false },
//     )
//     expect(statuses(checks)).toEqual(['invalid', 'invalid'])
//   })
//
//   it('reports unchecked — not invalid — when the RPC fails, preserving the reason', async () => {
//     const wrapper = `0x${'ab'.repeat(200)}` as const
//     const checks = await verifyOwnershipProofs(
//       { ...base, proofs: [wrapper, wrapper], at: ISSUED_AT + 60 },
//       {
//         verifyContractSignature: async () => {
//           throw new Error('base-sepolia unreachable')
//         },
//       },
//     )
//     expect(statuses(checks)).toEqual(['unchecked', 'unchecked'])
//     expect(checks[0].reason).toBe('base-sepolia unreachable')
//   })
// })

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
})
