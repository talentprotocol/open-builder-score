// Registers ATTEST_AGGREGATE_SCHEMA on Base Sepolia's SchemaRegistry predeploy.
//
//   node --env-file=.env scripts/register-aggregate-schema.mjs          # preflight only
//   node --env-file=.env scripts/register-aggregate-schema.mjs --send   # actually register
//
// Needs ATTESTATION_WALLET_KEY in the environment. The key is never logged and
// never leaves this process.
//
// The schema string is read out of src/lib/eas.ts rather than duplicated here,
// so there is one source of truth; the UID assertion below is the backstop if
// that read ever goes wrong.

import { readFileSync } from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  formatEther,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const SCHEMA_REGISTRY = '0x4200000000000000000000000000000000000020'
const EXPECTED_UID = '0x01d83b22aca3881b6673513b0e29fec6659a7def03c69fa41c55a16bcaf192a2'

const REGISTRY_ABI = parseAbi([
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))',
  'event Registered(bytes32 indexed uid, address indexed registerer, (bytes32 uid, address resolver, bool revocable, string schema) schema)',
])

function readSchemaFromSource() {
  const src = readFileSync(new URL('../src/lib/eas.ts', import.meta.url), 'utf8')
  const match = src.match(/export const ATTEST_AGGREGATE_SCHEMA\s*=\s*\n?\s*'([^']+)'/)
  if (!match) throw new Error('could not read ATTEST_AGGREGATE_SCHEMA from src/lib/eas.ts')
  return match[1]
}

const computeSchemaUid = (schema, resolver, revocable) =>
  keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]))

const send = process.argv.includes('--send')
const key = process.env.ATTESTATION_WALLET_KEY
if (!key) {
  console.error('ATTESTATION_WALLET_KEY is not set. Run with: node --env-file=.env ' + process.argv[1])
  process.exit(1)
}

const schema = readSchemaFromSource()
const uid = computeSchemaUid(schema, zeroAddress, true)

console.log('schema:  ', schema)
console.log('uid:     ', uid)
if (uid !== EXPECTED_UID) {
  console.error(`\nUID mismatch — expected ${EXPECTED_UID}.`)
  console.error('The schema string changed. Update the golden pins in test/eas.test.ts first.')
  process.exit(1)
}
console.log('         ✓ matches the pinned UID')

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() })

console.log('\nregistrant:', account.address)
const balance = await publicClient.getBalance({ address: account.address })
console.log('balance:   ', formatEther(balance), 'ETH (Base Sepolia)')

const existing = await publicClient
  .readContract({ address: SCHEMA_REGISTRY, abi: REGISTRY_ABI, functionName: 'getSchema', args: [uid] })
  .catch(() => null)

if (existing && existing.uid !== `0x${'00'.repeat(32)}`) {
  console.log('\nAlready registered — nothing to do.')
  console.log('  resolver: ', existing.resolver)
  console.log('  revocable:', existing.revocable)
  process.exit(0)
}
console.log('not yet registered on Base Sepolia')

if (!send) {
  console.log('\nPreflight only. Re-run with --send to register.')
  process.exit(0)
}

if (balance === 0n) {
  console.error('\nNo Base Sepolia ETH — fund the registrant first.')
  process.exit(1)
}

const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() })
console.log('\nregistering…')
const hash = await walletClient.writeContract({
  address: SCHEMA_REGISTRY,
  abi: REGISTRY_ABI,
  functionName: 'register',
  args: [schema, zeroAddress, true],
})
console.log('tx:      ', hash)

const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log('status:  ', receipt.status, `(block ${receipt.blockNumber})`)
if (receipt.status !== 'success') process.exit(1)

// Read the UID back out of the event rather than trusting the local computation.
const log = receipt.logs.find(
  (l) => l.address.toLowerCase() === SCHEMA_REGISTRY.toLowerCase(),
)
const onchainUid = log?.topics[1]
const registerer = log?.topics[2] ? `0x${log.topics[2].slice(26)}` : null
console.log('\nonchain uid:', onchainUid)
console.log('registerer: ', registerer)

if (onchainUid?.toLowerCase() !== uid.toLowerCase()) {
  console.error('\nRegistered UID does not match the pin — investigate before using it.')
  process.exit(1)
}
console.log('\n✓ registered, and the onchain UID matches the pinned one')
console.log(`  https://base-sepolia.easscan.org/schema/view/${uid}`)
