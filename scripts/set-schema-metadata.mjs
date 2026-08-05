// Names and describes our EAS schemas on easscan, by attesting to EAS's two
// well-known metadata schemas. easscan shows the creator's entry with an
// isCreator flag, so these must be sent from the schema's registrant.
//
//   node --env-file=.env scripts/set-schema-metadata.mjs          # preflight
//   node --env-file=.env scripts/set-schema-metadata.mjs --send   # attest
//
// Defaults to the aggregate schema only. Add --include-single for #2265.
//
// Note easscan renders both fields as PLAIN TEXT — no markdown, no
// autolinking (verified against a schema whose description contains markdown,
// and against an attestation whose value is a URL). The URL below is therefore
// something a reader copies, not clicks. It is spelled out in full for that
// reason.

import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, encodeAbiParameters, formatEther, http, parseAbi, parseAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const EAS = '0x4200000000000000000000000000000000000021'
const NAME_SCHEMA = '0x44d562ac1d7cd77e232978687fea027ace48f719cf1d58c7888e509663bb87fc'
const DESCRIPTION_SCHEMA = '0x21cbc60aac46ba22125ff85dd01882ebe6e87eb4fc46628589931ccbef9b8c94'

const SINGLE_UID = '0x38b1a4ab5bee04789565591b11646eb0f5269096f65ef0b24e817f2b6168d1cd'
// Task 10 (2026-08-05): retargeted from the prior schema generation's UID
// (0x01d83b22...a2, the now-demoted verify_url schema) to v3, schema #2308.
const AGGREGATE_UID = '0x9bba0ee6d4f74ab182e84e86c5c873ac5a37ef97f98ff7750f5dec7c3ac1edc7'

// Kept in sync with SITE_ORIGIN in src/lib/routes.ts — read, not duplicated.
function siteOrigin() {
  const src = readFileSync(new URL('../src/lib/routes.ts', import.meta.url), 'utf8')
  const m = src.match(/export const SITE_ORIGIN\s*=\s*'([^']+)'/)
  if (!m) throw new Error('could not read SITE_ORIGIN from src/lib/routes.ts')
  return m[1]
}

const ORIGIN = siteOrigin()

// #2265 is opt-in via --include-single: easscan recorded its creator as the
// MetaMask gas-station wallet that relayed the registration, not the registerer,
// so metadata from us is indexed but flagged isCreator: false. Kept here so it
// can be sent deliberately rather than rediscovered.
const ALL_ENTRIES = [
  {
    uid: AGGREGATE_UID,
    name: 'Open Builder Score (aggregate)',
    description:
      'Aggregate multi-wallet Builder Score from Open Builder Score, by Talent Protocol. ' +
      'The score is computed in the browser from public data and can be recomputed by anyone. ' +
      'extra_wallets holds the other wallets in the aggregate, and ownership_proofs[i] is an ' +
      'EIP-712 WalletOwnership signature by extra_wallets[i] binding it to this recipient wallet ' +
      'and scan, so the wallet set is checkable without trusting us. Any wallet in the set may ' +
      'send the attestation - the sender needs no stored proof, since EAS itself records it as ' +
      "the attester. recipient_ownership_proof holds the recipient's proof when an extra wallet " +
      'sends instead, so exactly one proof slot across the record is empty: the ' +
      "sender's. proofs_issued_at is the shared EIP-712 anchor every proof binds to. verify_url " +
      'opens the verification view for this wallet - what was verified, not a fresh scoring run. ' +
      'It is keyed on the recipient wallet rather than this attestation UID because EAS hashes ' +
      'both the record data and the block timestamp into the UID, so an attestation can never ' +
      'contain a link to itself. badges lists zero-point achievements earned at scan time: they ' +
      'never affect the score, and two of them rest on dated Talent Protocol exports with no ' +
      `permissionless source, so a verifier can re-derive some and only echo the rest. App: ${ORIGIN}`,
  },
  {
    uid: SINGLE_UID,
    name: 'Open Builder Score',
    description:
      'Single-wallet Builder Score from Open Builder Score, by Talent Protocol. ' +
      'The score is computed in the browser from public data and can be recomputed by anyone ' +
      'from spec_version, computed_at and block_number. The attester is the scored wallet ' +
      `itself. Verify any attestation by opening ${ORIGIN}/verify/ followed by its UID.`,
  },
]

const EAS_ABI = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct AttestationRequest { bytes32 schema; AttestationRequestData data; }',
  'function attest(AttestationRequest request) payable returns (bytes32)',
])

const send = process.argv.includes('--send')
const includeSingle = process.argv.includes('--include-single')
const ENTRIES = ALL_ENTRIES.filter((e) => includeSingle || e.uid === AGGREGATE_UID)
const key = process.env.ATTESTATION_WALLET_KEY
if (!key) {
  console.error('ATTESTATION_WALLET_KEY is not set. Run with: node --env-file=.env ' + process.argv[1])
  process.exit(1)
}

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() })

console.log('origin:  ', ORIGIN, '(from src/lib/routes.ts)')
console.log('attester:', account.address)
console.log('balance: ', formatEther(await publicClient.getBalance({ address: account.address })), 'ETH\n')

for (const e of ENTRIES) {
  console.log(`schema ${e.uid.slice(0, 10)}…`)
  console.log(`  name:        ${e.name}`)
  console.log(`  description: ${e.description}`)
  console.log(`               (${e.description.length} chars)\n`)
}

if (!send) {
  console.log('Preflight only. Re-run with --send to attest.')
  process.exit(0)
}

const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() })

const attest = async (schema, data, label) => {
  const hash = await walletClient.writeContract({
    address: EAS,
    abi: EAS_ABI,
    functionName: 'attest',
    args: [
      {
        schema,
        data: {
          recipient: '0x0000000000000000000000000000000000000000',
          expirationTime: 0n,
          revocable: true,
          refUID: `0x${'00'.repeat(32)}`,
          data,
          value: 0n,
        },
      },
    ],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`  ${label}: ${receipt.status}  ${hash}`)
  if (receipt.status !== 'success') process.exit(1)
}

for (const e of ENTRIES) {
  console.log(`attesting metadata for ${e.uid.slice(0, 10)}…`)
  await attest(
    NAME_SCHEMA,
    encodeAbiParameters(parseAbiParameters('bytes32 schemaId, string name'), [e.uid, e.name]),
    'name       ',
  )
  await attest(
    DESCRIPTION_SCHEMA,
    encodeAbiParameters(parseAbiParameters('bytes32 schemaId, string description'), [e.uid, e.description]),
    'description',
  )
}

console.log('\n✓ done')
for (const e of ENTRIES) console.log(`  https://base-sepolia.easscan.org/schema/view/${e.uid}`)
