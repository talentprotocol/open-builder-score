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
