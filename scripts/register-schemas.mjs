// Registers both live attestation schemas (single + aggregate) on Base
// mainnet's SchemaRegistry predeploy. Skips any schema already registered,
// so it is safe to re-run.
//
//   node --env-file=.env scripts/register-schemas.mjs          # preflight only
//   node --env-file=.env scripts/register-schemas.mjs --send   # actually register
//
// Needs ATTESTATION_WALLET_KEY in the environment. The key is never logged and
// never leaves this process.
//
// The schema strings are read out of src/lib/eas.ts rather than duplicated
// here, so there is one source of truth; the UID pins below are the backstop
// if that read ever goes wrong. UIDs hash only (schema, resolver, revocable),
// so each schema keeps the same UID it has on Base Sepolia.

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
import { base } from 'viem/chains'

const SCHEMA_REGISTRY = '0x4200000000000000000000000000000000000020'

// Golden pins from test/eas.test.ts — verified onchain against Base Sepolia's
// SchemaRegistry.getSchema (#2265 single, #2308 aggregate).
const SCHEMAS = [
  {
    name: 'ATTEST_SCHEMA',
    expectedUid: '0x38b1a4ab5bee04789565591b11646eb0f5269096f65ef0b24e817f2b6168d1cd',
  },
  {
    name: 'ATTEST_AGGREGATE_SCHEMA',
    expectedUid: '0x9bba0ee6d4f74ab182e84e86c5c873ac5a37ef97f98ff7750f5dec7c3ac1edc7',
  },
]

const REGISTRY_ABI = parseAbi([
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))',
  'event Registered(bytes32 indexed uid, address indexed registerer, (bytes32 uid, address resolver, bool revocable, string schema) schema)',
])

const source = readFileSync(new URL('../src/lib/eas.ts', import.meta.url), 'utf8')

function readSchemaFromSource(constName) {
  const match = source.match(new RegExp(`export const ${constName}\\s*=\\s*\\n?\\s*'([^']+)'`))
  if (!match) throw new Error(`could not read ${constName} from src/lib/eas.ts`)
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

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
const publicClient = createPublicClient({ chain: base, transport: http() })

console.log('registrant:', account.address)
const balance = await publicClient.getBalance({ address: account.address })
console.log('balance:   ', formatEther(balance), 'ETH (Base mainnet)\n')

const ZERO_UID = `0x${'00'.repeat(32)}`
const pending = []

for (const entry of SCHEMAS) {
  const schema = readSchemaFromSource(entry.name)
  const uid = computeSchemaUid(schema, zeroAddress, true)

  console.log(`${entry.name}`)
  console.log('  schema:', schema)
  console.log('  uid:   ', uid)
  if (uid !== entry.expectedUid) {
    console.error(`\n  UID mismatch — expected ${entry.expectedUid}.`)
    console.error('  The schema string changed. Update the golden pins in test/eas.test.ts first.')
    process.exit(1)
  }
  console.log('          ✓ matches the pinned UID')

  const existing = await publicClient
    .readContract({ address: SCHEMA_REGISTRY, abi: REGISTRY_ABI, functionName: 'getSchema', args: [uid] })
    .catch(() => null)

  if (existing && existing.uid !== ZERO_UID) {
    console.log('          already registered on Base — skipping\n')
    continue
  }
  console.log('          not yet registered on Base\n')
  pending.push({ ...entry, schema, uid })
}

if (pending.length === 0) {
  console.log('Nothing to register — both schemas are live on Base.')
  process.exit(0)
}

if (!send) {
  console.log(`Preflight only. Re-run with --send to register ${pending.length} schema(s).`)
  process.exit(0)
}

if (balance === 0n) {
  console.error('No Base ETH — fund the registrant first.')
  process.exit(1)
}

const walletClient = createWalletClient({ account, chain: base, transport: http() })

for (const entry of pending) {
  console.log(`registering ${entry.name}…`)
  const hash = await walletClient.writeContract({
    address: SCHEMA_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'register',
    args: [entry.schema, zeroAddress, true],
  })
  console.log('  tx:    ', hash)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log('  status:', receipt.status, `(block ${receipt.blockNumber})`)
  if (receipt.status !== 'success') process.exit(1)

  // Read the UID back out of the event rather than trusting the local computation.
  const log = receipt.logs.find((l) => l.address.toLowerCase() === SCHEMA_REGISTRY.toLowerCase())
  const onchainUid = log?.topics[1]
  if (onchainUid?.toLowerCase() !== entry.uid.toLowerCase()) {
    console.error('  Registered UID does not match the pin — investigate before using it.')
    process.exit(1)
  }
  console.log('  ✓ onchain UID matches the pin')
  console.log(`  https://base.easscan.org/schema/view/${entry.uid}\n`)
}

console.log('✓ done — Base mainnet registration complete')
