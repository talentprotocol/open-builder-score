import { EAS, NO_EXPIRATION, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { encodePacked, keccak256, zeroAddress } from 'viem'
import type { WalletClient } from 'viem'

// OP-stack predeploys — same address on Base and Base Sepolia.
// Verified against EAS docs at registration time (Task 11).
export const EAS_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000021'
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020'

// README-proposed schema. EAS canonical form: comma-separated, no spaces.
export const ATTEST_SCHEMA =
  'string spec_version,address wallet,string github_handle,uint16 score,uint64 computed_at,uint64 block_number'

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
