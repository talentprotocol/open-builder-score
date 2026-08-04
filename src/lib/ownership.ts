// Ownership proofs for aggregate (multi-wallet) attestations.
//
// The primary wallet needs no proof: EAS records the attester as msg.sender, so
// the attestation transaction is its proof. Wallets 2-5 have no msg.sender, so
// each signs an EIP-712 message and the signature goes *into* the attestation.
// That is the whole difference from a SIWE personal_sign: the signature leaves
// the browser and lands onchain, where anyone can check it — for EOAs, forever
// and without a network call.

import { recoverTypedDataAddress } from 'viem'
import { ATTEST_CHAIN_ID, EAS_CONTRACT_ADDRESS } from './eas'
import { clientFor } from './chains'

export const MAX_EXTRA_WALLETS = 4

// The window's job is to kill year-old proofs, not to be a nonce — replay into
// someone else's aggregate is already impossible, since primary and the whole
// wallet set are bound into the message. A day is long enough that a user who
// leaves the tab open over lunch doesn't hit a confusing dead end.
export const OWNERSHIP_PROOF_TTL_SECONDS = 86_400

export const OWNERSHIP_DOMAIN_NAME = 'Open Builder Score'

// The proof format's version, deliberately NOT spec.version: binding the spec
// would force re-signing every wallet on every credential re-cut, and the
// ownership claim is about wallets, not about the score.
export const OWNERSHIP_DOMAIN_VERSION = '1'

export const OWNERSHIP_STATEMENT =
  'I own this wallet and consent to including it in this Open Builder Score aggregate.'

export const OWNERSHIP_TYPES = {
  WalletOwnership: [
    { name: 'statement', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'primary', type: 'address' },
    { name: 'wallets', type: 'address[]' },
    { name: 'computedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const

export interface OwnershipMessageArgs {
  primary: `0x${string}`
  wallet: `0x${string}`
  extras: `0x${string}`[]
  computedAt: number
  chainId?: number
}

// Deterministic in every input — nothing here reads the clock, so a proof can be
// reconstructed at verify time from the attestation alone. The return type is
// inferred rather than widened to TypedDataDefinition so it stays spreadable
// into viem's sign/recover/verify parameters.
export function ownershipTypedData(args: OwnershipMessageArgs) {
  const extras = canonicalExtraWallets(args.primary, args.extras)
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
  primary: `0x${string}`,
  extras: `0x${string}`[],
): `0x${string}`[] {
  const seen = new Set<string>([primary.toLowerCase()])
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
export type ProofStatus = 'eoa' | 'contract' | 'invalid' | 'unchecked' | 'expired' | 'missing'

export interface ProofCheck {
  wallet: `0x${string}`
  status: ProofStatus
  reason?: string
}

export type OwnershipTypedData = ReturnType<typeof ownershipTypedData>

export interface VerifyContractSignatureArgs {
  address: `0x${string}`
  typedData: OwnershipTypedData
  signature: `0x${string}`
  blockNumber?: bigint
}

export interface VerifyOwnershipArgs {
  primary: `0x${string}`
  extras: `0x${string}`[]
  proofs: `0x${string}`[]
  computedAt: number
  /** att.timeCreated when verifying, now when attesting. */
  at: number
  chainId?: number
  /** Public Base RPCs prune state, so as-of-block ERC-1271 needs an archive node. */
  blockNumber?: bigint
}

export interface OwnershipIO {
  verifyContractSignature?: (args: VerifyContractSignatureArgs) => Promise<boolean>
}

export async function verifyOwnershipProofs(
  args: VerifyOwnershipArgs,
  io: OwnershipIO = {},
): Promise<ProofCheck[]> {
  const chainId = args.chainId ?? ATTEST_CHAIN_ID
  const verifyContract =
    io.verifyContractSignature ??
    (({ address, typedData, signature, blockNumber }: VerifyContractSignatureArgs) =>
      clientFor(chainId).verifyTypedData({
        address,
        ...typedData,
        signature,
        // Spread conditionally: viem's block selector is a union, so an explicit
        // `blockNumber: undefined` is not the same as omitting it.
        ...(blockNumber === undefined ? {} : { blockNumber }),
      }))

  return Promise.all(
    args.extras.map(async (wallet, i): Promise<ProofCheck> => {
      const signature = args.proofs[i]
      if (!signature || signature === '0x') return { wallet, status: 'missing' }

      // Checked before any network call — nothing is gained by asking a contract
      // about a signature whose consent window has already closed.
      if (args.at > args.computedAt + OWNERSHIP_PROOF_TTL_SECONDS) {
        return { wallet, status: 'expired' }
      }

      const typedData = ownershipTypedData({
        primary: args.primary,
        wallet,
        extras: args.extras,
        computedAt: args.computedAt,
        chainId,
      })

      // Offline first. For an EOA this is pure arithmetic over bytes already
      // onchain: no server, no RPC, verifiable by anyone forever.
      try {
        const recovered = await recoverTypedDataAddress({
          ...typedData,
          signature,
        })
        if (recovered.toLowerCase() === wallet.toLowerCase()) return { wallet, status: 'eoa' }
      } catch {
        // Not a plain 65-byte ECDSA signature — a smart-account wrapper, most
        // likely. Note this path is NOT reached by an EIP-7702 delegated EOA
        // that signs with its own key: recovery succeeds there even though the
        // account has code, which is why offline recovery is tried first.
      }

      try {
        const valid = await verifyContract({
          address: wallet,
          typedData,
          signature,
          blockNumber: args.blockNumber,
        })
        return { wallet, status: valid ? 'contract' : 'invalid' }
      } catch (e) {
        return {
          wallet,
          status: 'unchecked',
          reason: e instanceof Error ? e.message : 'signature check unavailable',
        }
      }
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
