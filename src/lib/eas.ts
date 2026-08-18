import { encodePacked, keccak256, zeroAddress } from 'viem'
import type { WalletClient } from 'viem'

// OP-stack predeploys — same address on Base and Base Sepolia.
// Verified against EAS docs at registration time.
export const EAS_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000021' as const
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020' as const

// README-proposed schema. EAS canonical form: comma-separated, no spaces.
export const ATTEST_SCHEMA =
  'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number'

// Aggregate (multi-wallet) scores. `wallet` stays the recipient — it keeps the
// recipient == wallet invariant, keeps isSelfAttested unchanged, and leaves
// ownership_proofs[i] a clean 1:1 with extra_wallets[i].
//
// ownership_proofs is bytes[] rather than a fixed width because a smart account
// returns an ABI-encoded wrapper — and, while still counterfactual, an ERC-6492
// wrapper of several hundred bytes. Signatures are stored verbatim, never
// unwrapped: the wrapper is what makes a counterfactual signature verifiable.
// verify_url points at the verification view for this wallet, not at a fresh
// scoring run — someone reading the record wants what was verified, not a new
// computation. It is keyed on the recipient wallet rather than on this
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
//
// v3 (2026-08-05): any wallet of the set may send the attestation. The sender
// needs no stored proof — EAS records it as the attester, which is its proof —
// so exactly one proof slot is '0x': recipient_ownership_proof when the
// recipient sends, or that extra's ownership_proofs slot. proofs_issued_at is
// the shared EIP-712 anchor every signature binds; a forged value makes every
// proof fail recovery, so it cannot be quietly edited.
//
// Registered on Base Sepolia (2026-08-05, schema #2308,
// tx 0xa8d87dff68fd14d0c7c43c8a0ddd23ed156ce738f6f9a48c6245408ed0831c76) and on
// Base mainnet (2026-08-18, scripts/register-schemas.mjs); resolver 0x0, revocable.
// Same UID on both chains — it hashes only (schema, resolver, revocable).
// Golden-pinned in test/eas.test.ts, verified against SchemaRegistry.getSchema and easscan.
export const ATTEST_AGGREGATE_SCHEMA =
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,bytes recipient_ownership_proof,uint64 proofs_issued_at,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges'

export const ATTEST_AGGREGATE_SCHEMA_UID = computeSchemaUid(
  ATTEST_AGGREGATE_SCHEMA,
  zeroAddress,
  true,
)

// Base mainnet. The POC ran on Base Sepolia (84532); both schemas are also
// registered there, but nothing in the app writes or reads Sepolia anymore.
export const ATTEST_CHAIN_ID: number = 8453

// The POC's Sepolia records live on base-sepolia.easscan.org; this app no
// longer reads them.
export const EASSCAN_SITE = 'https://base.easscan.org'

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

// Demoted 2026-08-05: predates the recipient proof slot. Decode-only.
export const ATTEST_AGGREGATE_VERIFY_URL_SCHEMA =
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges'

// Registered on Base Sepolia (2026-08-04), resolver 0x0, revocable.
// Golden-pinned in test/eas.test.ts — a change here breaks decoding of every
// aggregate attestation made before the recipient proof slot existed.
export const ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID = computeSchemaUid(
  ATTEST_AGGREGATE_VERIFY_URL_SCHEMA,
  zeroAddress,
  true,
)

export const KNOWN_SCHEMA_UIDS = [
  ATTEST_SCHEMA_UID,
  ATTEST_AGGREGATE_SCHEMA_UID,
  ATTEST_AGGREGATE_LEGACY_SCHEMA_UID,
  ATTEST_AGGREGATE_SCORE_URL_SCHEMA_UID,
  ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID,
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

// Every message a preflight check in ./eas-attest can throw before a signer
// or transaction exists — none of them mean "the attestation failed onchain",
// so the caller (attest-panel's handleAttest) shows these verbatim instead
// of routing them through the generic post-tx wallet-error mapping.
export const AGGREGATE_PREFLIGHT_ERRORS: readonly string[] = [
  'wallet not connected',
  'an aggregate attestation needs at least one extra wallet',
  'every extra wallet needs exactly one ownership proof',
  'every wallet needs a stored ownership proof or the attester exemption — a proof slot is missing or malformed',
  'exactly one wallet — the one sending the transaction — may rely on msg.sender as its proof',
]

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
