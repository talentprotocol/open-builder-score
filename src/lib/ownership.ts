// Ownership proofs for aggregate (multi-wallet) attestations. Every wallet in
// the set must be proven — by an EIP-712 signature stored in the attestation,
// or by being the transaction sender EAS records as the attester.
//
// Whichever wallet sends the attestation needs no proof: EAS records the
// attester as msg.sender, so the attestation transaction is its proof. Every
// other wallet in the set has no msg.sender, so each signs an EIP-712 message
// and the signature goes *into* the attestation.
// That is the whole difference from a SIWE personal_sign: the signature leaves
// the browser and lands onchain, where anyone can check it — for EOAs, forever
// and without a network call.

import { recoverTypedDataAddress } from 'viem'
import { ATTEST_CHAIN_ID, EAS_CONTRACT_ADDRESS } from './eas'
import { clientFor } from './chains'

export const MAX_EXTRA_WALLETS = 4

// The window's job is to kill year-old proofs, not to be a nonce — replay into
// someone else's aggregate is already impossible, since the recipient and the
// whole wallet set are bound into the message. A day is long enough that a
// user who leaves the tab open over lunch doesn't hit a confusing dead end.
export const OWNERSHIP_PROOF_TTL_SECONDS = 86_400

export const OWNERSHIP_DOMAIN_NAME = 'Open Builder Score'

// v2 renames the v1 message fields — the exempt wallet becomes `recipient`,
// and `computedAt` becomes `issuedAt`. The ownership claim is
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

// The onchain extra_wallets array IS this array, so ownership_proofs[i] lines up
// with extra_wallets[i] with no index mapping anywhere.
export function canonicalExtraWallets(
  recipient: `0x${string}`,
  extras: `0x${string}`[],
): `0x${string}`[] {
  const seen = new Set<string>([recipient.toLowerCase()])
  const unique: `0x${string}`[] = []
  for (const extra of extras) {
    const key = extra.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(extra)
  }
  return unique.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
}

// 'unchecked' is deliberate: an RPC hiccup while asking a smart account whether
// it accepts a signature must never render as "forged". Same rule the chain
// reads already follow — couldn't check is not the same as not earned.
export type ProofStatus =
  | 'eoa'
  | 'contract'
  | 'invalid'
  | 'unchecked'
  | 'expired'
  | 'missing'
  | 'attester'

export interface ProofCheck {
  wallet: `0x${string}`
  status: ProofStatus
  reason?: string
}

export type OwnershipTypedData = ReturnType<typeof ownershipTypedData>
export type LegacyOwnershipTypedData = ReturnType<typeof legacyOwnershipTypedData>

export interface VerifyContractSignatureArgs {
  address: `0x${string}`
  typedData: OwnershipTypedData | LegacyOwnershipTypedData
  signature: `0x${string}`
  blockNumber?: bigint
}

export interface OwnershipIO {
  verifyContractSignature?: (args: VerifyContractSignatureArgs) => Promise<boolean>
}

type VerifyContractFn = (args: VerifyContractSignatureArgs) => Promise<boolean>

function defaultVerifyContract(chainId: number): VerifyContractFn {
  return ({ address, typedData, signature, blockNumber }) =>
    clientFor(chainId).verifyTypedData({
      address,
      ...typedData,
      signature,
      // Spread conditionally: viem's block selector is a union, so an explicit
      // `blockNumber: undefined` is not the same as omitting it.
      ...(blockNumber === undefined ? {} : { blockNumber }),
    })
}

// `recover` is bound by the caller against typedData's concrete (non-union)
// type. viem's generic can't correlate `types`/`primaryType`/`message` across
// the OwnershipTypedData | LegacyOwnershipTypedData union at this boundary —
// binding per-branch, where the shape is concrete, sidesteps that rather than
// casting it away.
async function checkSignature(
  wallet: `0x${string}`,
  typedData: OwnershipTypedData | LegacyOwnershipTypedData,
  signature: `0x${string}`,
  verifyContract: VerifyContractFn,
  recover: (signature: `0x${string}`) => Promise<`0x${string}`>,
  blockNumber?: bigint,
): Promise<ProofCheck> {
  // Offline first. For an EOA this is pure arithmetic over bytes already
  // onchain: no server, no RPC, verifiable by anyone forever.
  try {
    const recovered = await recover(signature)
    if (recovered.toLowerCase() === wallet.toLowerCase()) return { wallet, status: 'eoa' }
  } catch {
    // Not a plain 65-byte ECDSA signature — a smart-account wrapper, most
    // likely. Note this path is NOT reached by an EIP-7702 delegated EOA
    // that signs with its own key: recovery succeeds there even though the
    // account has code, which is why offline recovery is tried first.
  }
  try {
    const valid = await verifyContract({ address: wallet, typedData, signature, blockNumber })
    return { wallet, status: valid ? 'contract' : 'invalid' }
  } catch (e) {
    return {
      wallet,
      status: 'unchecked',
      reason: e instanceof Error ? e.message : 'signature check unavailable',
    }
  }
}

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
      const recover = (sig: `0x${string}`) => recoverTypedDataAddress({ ...typedData, signature: sig })
      return checkSignature(wallet, typedData, signature, verifyContract, recover, args.blockNumber)
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
      const recover = (sig: `0x${string}`) => recoverTypedDataAddress({ ...typedData, signature: sig })
      return checkSignature(wallet, typedData, signature, verifyContract, recover, args.blockNumber)
    }),
  )
}

export type ProofSummary = 'all_proved' | 'some_unchecked' | 'failed'

// A failure outranks an unchecked proof: if one wallet is demonstrably not the
// signer's, that is the headline regardless of what could not be reached.
export function aggregateProofSummary(checks: ProofCheck[]): ProofSummary {
  if (checks.some((c) => c.status === 'invalid' || c.status === 'expired' || c.status === 'missing'))
    return 'failed'
  if (checks.some((c) => c.status === 'unchecked')) return 'some_unchecked'
  return 'all_proved'
}
