import { EAS, NO_EXPIRATION, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { encodePacked, keccak256, zeroAddress } from 'viem'
import { absoluteUrl, verifyWalletPath } from './routes'
import type { WalletClient } from 'viem'

// OP-stack predeploys — same address on Base and Base Sepolia.
// Verified against EAS docs at registration time (Task 11).
export const EAS_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000021' as const
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020' as const

// README-proposed schema. EAS canonical form: comma-separated, no spaces.
export const ATTEST_SCHEMA =
  'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number'

// Aggregate (multi-wallet) scores. `wallet` stays the primary — it keeps the
// recipient == wallet invariant, keeps isSelfAttested unchanged, and leaves
// ownership_proofs[i] a clean 1:1 with extra_wallets[i]. The primary needs no
// proof: EAS records the attester as msg.sender, which is its proof.
//
// ownership_proofs is bytes[] rather than a fixed width because a smart account
// returns an ABI-encoded wrapper — and, while still counterfactual, an ERC-6492
// wrapper of several hundred bytes. Signatures are stored verbatim, never
// unwrapped: the wrapper is what makes a counterfactual signature verifiable.
// verify_url points at the verification view for this wallet, not at a fresh
// scoring run — someone reading the record wants what was verified, not a new
// computation. It is keyed on the primary wallet rather than on this
// attestation's UID because an attestation cannot contain a link to itself:
// EAS hashes both the record's own data AND block.timestamp into the UID, so
// the UID is neither self-containable nor knowable before the tx is mined.
// (Both confirmed by recomputing a live attestation's UID from its fields.)
//
// badges carries the slugs earned at scan time. They are zero-point, so they
// cannot move the score — but two of them are dated exports from Talent
// Protocol with no permissionless source, so a verifier can confirm some and
// only echo the rest. verify.ts classifies each, and the verify screen says
// which is which rather than implying all were proven.
export const ATTEST_AGGREGATE_SCHEMA =
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges'

export const ATTEST_CHAIN_ID: number = 84532 // Base Sepolia first; switch to 8453 (Base) post-registration

export const EASSCAN_SITE =
  ATTEST_CHAIN_ID === 84532
    ? 'https://base-sepolia.easscan.org'
    : 'https://base.easscan.org'

export function computeSchemaUid(
  schema: string,
  resolver: `0x${string}`,
  revocable: boolean,
): `0x${string}` {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]))
}

// Deterministic: identical on every chain for (schema, zero resolver, revocable=true).
// Registration (Task 11) must produce exactly this UID or the config is wrong.
export const ATTEST_SCHEMA_UID = computeSchemaUid(ATTEST_SCHEMA, zeroAddress, true)

// Registered on Base Sepolia (2026-08-04), resolver 0x0, revocable.
// Golden-pinned in test/eas.test.ts — a change here breaks aggregate attestation.
export const ATTEST_AGGREGATE_SCHEMA_UID = computeSchemaUid(
  ATTEST_AGGREGATE_SCHEMA,
  zeroAddress,
  true,
)

// Superseded by ATTEST_AGGREGATE_SCHEMA (score_url + badges replaced the
// prefix), but real attestations exist against it and must keep verifying —
// the same reason the single-wallet schema was never retired. Decode-only:
// nothing new is ever attested here.
export const ATTEST_AGGREGATE_LEGACY_SCHEMA =
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url_prefix'

export const ATTEST_AGGREGATE_LEGACY_SCHEMA_UID = computeSchemaUid(
  ATTEST_AGGREGATE_LEGACY_SCHEMA,
  zeroAddress,
  true,
)

// #2306: same shape as current, but the URL pointed at a fresh scoring run.
export const ATTEST_AGGREGATE_SCORE_URL_SCHEMA =
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string score_url,string[] badges'

export const ATTEST_AGGREGATE_SCORE_URL_SCHEMA_UID = computeSchemaUid(
  ATTEST_AGGREGATE_SCORE_URL_SCHEMA,
  zeroAddress,
  true,
)

export const KNOWN_SCHEMA_UIDS = [
  ATTEST_SCHEMA_UID,
  ATTEST_AGGREGATE_SCHEMA_UID,
  ATTEST_AGGREGATE_LEGACY_SCHEMA_UID,
  ATTEST_AGGREGATE_SCORE_URL_SCHEMA_UID,
] as const

export interface AttestParams {
  walletClient: WalletClient
  recipient: `0x${string}`
  specVersion: string
  githubHandle: string | null
  score: number
  computedAt: number
  blockNumber: bigint
}

function walletClientToSigner(walletClient: WalletClient): JsonRpcSigner {
  const { account, chain, transport } = walletClient
  if (!account || !chain) throw new Error('wallet not connected')
  const provider = new BrowserProvider(transport, { chainId: chain.id, name: chain.name })
  return new JsonRpcSigner(provider, account.address)
}

export interface AggregateAttestParams extends AttestParams {
  /** Canonical order — canonicalExtraWallets(). Index i pairs with ownershipProofs[i]. */
  extraWallets: `0x${string}`[]
  ownershipProofs: `0x${string}`[]
  /** Slugs of the badges earned at scan time. Zero-point by construction. */
  badges: string[]
}

// Split out from attestAggregateScore so the bytes can be tested without a wallet,
// and so the encode path is pinned against the decode path the verifier uses.
export function encodeAggregateAttestationData(
  params: Omit<AggregateAttestParams, 'walletClient' | 'recipient'> & { wallet: `0x${string}` },
): `0x${string}` {
  if (params.extraWallets.length === 0) {
    throw new Error('an aggregate attestation needs at least one extra wallet')
  }
  if (params.extraWallets.length !== params.ownershipProofs.length) {
    throw new Error('every extra wallet needs exactly one ownership proof')
  }

  const encoder = new SchemaEncoder(ATTEST_AGGREGATE_SCHEMA)
  return encoder.encodeData([
    { name: 'spec_version', value: params.specVersion, type: 'string' },
    { name: 'wallet', value: params.wallet, type: 'address' },
    { name: 'extra_wallets', value: params.extraWallets, type: 'address[]' },
    { name: 'ownership_proofs', value: params.ownershipProofs, type: 'bytes[]' },
    { name: 'github_handle', value: params.githubHandle ?? '', type: 'string' },
    { name: 'score', value: params.score, type: 'uint16' },
    { name: 'computed_at', value: BigInt(params.computedAt), type: 'uint64' },
    { name: 'block_number', value: params.blockNumber, type: 'uint64' },
    // Derived from the app's own router so it cannot drift from real routing.
    { name: 'verify_url', value: absoluteUrl(verifyWalletPath(params.wallet)), type: 'string' },
    { name: 'badges', value: params.badges, type: 'string[]' },
  ]) as `0x${string}`
}

export async function attestAggregateScore(
  params: AggregateAttestParams,
): Promise<`0x${string}`> {
  const signer = walletClientToSigner(params.walletClient)
  const eas = new EAS(EAS_CONTRACT_ADDRESS)
  eas.connect(signer)

  const data = encodeAggregateAttestationData({ ...params, wallet: params.recipient })

  const tx = await eas.attest({
    schema: ATTEST_AGGREGATE_SCHEMA_UID,
    data: {
      // Recipient is the primary, so history and the percentile corpus stay
      // keyed the same way they are for single-wallet attestations.
      recipient: params.recipient,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      data,
    },
  })
  return (await tx.wait()) as `0x${string}`
}

export async function attestScore(params: AttestParams): Promise<`0x${string}`> {
  const signer = walletClientToSigner(params.walletClient)
  const eas = new EAS(EAS_CONTRACT_ADDRESS)
  eas.connect(signer)

  const encoder = new SchemaEncoder(ATTEST_SCHEMA)
  const data = encoder.encodeData([
    { name: 'spec_version', value: params.specVersion, type: 'string' },
    { name: 'wallet', value: params.recipient, type: 'address' },
    { name: 'github_handle', value: params.githubHandle ?? '', type: 'string' },
    { name: 'score', value: params.score, type: 'uint16' },
    { name: 'computed_at', value: BigInt(params.computedAt), type: 'uint64' },
    { name: 'block_number', value: params.blockNumber, type: 'uint64' },
  ])

  const tx = await eas.attest({
    schema: ATTEST_SCHEMA_UID,
    data: {
      recipient: params.recipient,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      data,
    },
  })
  return (await tx.wait()) as `0x${string}`
}
