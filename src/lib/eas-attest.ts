// The write side of attestation — the only module that touches the EAS SDK
// and ethers. It is deliberately separate from ./eas (constants + pure
// helpers, imported all over the app): keeping the SDK imports here, behind
// the attest-panel's click-time `import()`, keeps ~150KB of gzipped wallet
// tooling out of every page's first load.
import { EAS, NO_EXPIRATION, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import type { WalletClient } from 'viem'
import { absoluteUrl, verifyWalletPath } from './routes'
import {
  ATTEST_AGGREGATE_SCHEMA,
  ATTEST_AGGREGATE_SCHEMA_UID,
  EAS_CONTRACT_ADDRESS,
  type AggregateAttestParams,
} from './eas'

function walletClientToSigner(walletClient: WalletClient): JsonRpcSigner {
  const { account, chain, transport } = walletClient
  if (!account || !chain) throw new Error('wallet not connected')
  const provider = new BrowserProvider(transport, { chainId: chain.id, name: chain.name })
  return new JsonRpcSigner(provider, account.address)
}
// Split out from attestAggregateScore so the bytes can be tested without a wallet,
// and so the encode path is pinned against the decode path the verifier uses.
export function encodeAggregateAttestationData(
  params: Omit<AggregateAttestParams, 'walletClient' | 'recipient'> & { wallet: `0x${string}` },
): `0x${string}` {
  // extraWallets may be empty: a solo score is the N=1 set, where the sender
  // is the recipient and msg.sender is the only proof (recipientProof '0x').
  if (params.extraWallets.length !== params.ownershipProofs.length) {
    throw new Error('every extra wallet needs exactly one ownership proof')
  }

  const encoder = new SchemaEncoder(ATTEST_AGGREGATE_SCHEMA)
  return encoder.encodeData([
    { name: 'spec_version', value: params.specVersion, type: 'string' },
    { name: 'wallet', value: params.wallet, type: 'address' },
    { name: 'extra_wallets', value: params.extraWallets, type: 'address[]' },
    { name: 'ownership_proofs', value: params.ownershipProofs, type: 'bytes[]' },
    { name: 'recipient_ownership_proof', value: params.recipientProof, type: 'bytes' },
    { name: 'proofs_issued_at', value: BigInt(params.proofsIssuedAt), type: 'uint64' },
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

  const account = params.walletClient.account
  if (!account) throw new Error('wallet not connected')
  const slots: Array<[`0x${string}`, `0x${string}`]> = [
    [params.recipient, params.recipientProof],
    ...params.extraWallets.map((w, i): [`0x${string}`, `0x${string}`] => [w, params.ownershipProofs[i]]),
  ]
  // A slot must be exactly '0x' (the attester exemption) or a real proof
  // byte string — never undefined/missing, which would otherwise sail into
  // SchemaEncoder and fail there with an opaque SDK error instead of this one.
  const malformed = slots.filter(
    ([, proof]) =>
      proof !== '0x' && !(typeof proof === 'string' && proof.startsWith('0x') && proof.length > 2),
  )
  if (malformed.length > 0) {
    throw new Error(
      'every wallet needs a stored ownership proof or the attester exemption — a proof slot is missing or malformed',
    )
  }
  const empty = slots.filter(([, proof]) => proof === '0x')
  if (empty.length !== 1 || empty[0][0].toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      'exactly one wallet — the one sending the transaction — may rely on msg.sender as its proof',
    )
  }

  const data = encodeAggregateAttestationData({ ...params, wallet: params.recipient })

  const tx = await eas.attest({
    schema: ATTEST_AGGREGATE_SCHEMA_UID,
    data: {
      // The recipient anchors history and the percentile corpus the same way
      // it does for single-wallet attestations.
      recipient: params.recipient,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      data,
    },
  })
  return (await tx.wait()) as `0x${string}`
}
