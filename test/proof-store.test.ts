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
