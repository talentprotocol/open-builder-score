#!/usr/bin/env node
// Builds spec/allowlists/talent-token-launched.json from the v1 TalentFactory
// creation history on Celo and Polygon.
//
//   node scripts/build-talent-token-allowlist.mjs
//
// Why an allowlist rather than a live read, when the factories are right there:
// the Celo deployment never populated the talent → token direction.
// talentsToTokens(talent) returns 0x0 even for wallets whose createTalent call
// succeeded, and hasTalentToken reverts outright — only tokensToTalents(token)
// works, which cannot be asked from a wallet address. Polygon's deployment does
// answer talentsToTokens, but it holds 20 of the 564 talents; a Polygon-only
// live read would silently miss the whole Celo cohort.
//
// Both factories have been dormant since July 2023 and v1 is closed, so the set
// is frozen. Unlike the Builder Score and Builder Rewards snapshots, this is
// public chain data: anyone can re-run this script and get the same list.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// keccak256("TalentCreated(address,address)")
const TALENT_CREATED = '0xc3cff6724200e4907489fef1d1ede51dd32ca7ac86d62c448475be4c3b1d5b50'

const FACTORIES = [
  {
    chain: 'celo-mainnet',
    explorer: 'https://celo.blockscout.com',
    address: '0xa902da7a40a671b84ba3dd0bdba6fd9d2d888246',
  },
  {
    chain: 'polygon-mainnet',
    explorer: 'https://polygon.blockscout.com',
    address: '0xa91b75e8aa2dc62b2957333b1a1412532444fde0',
  },
]

// topic1 is the indexed talent address, left-padded to 32 bytes.
function talentFromTopic(topic) {
  return `0x${topic.slice(26)}`.toLowerCase()
}

async function fetchTalents({ explorer, address }) {
  const url = `${explorer}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${address}&topic0=${TALENT_CREATED}`
  const response = await fetch(url, { headers: { 'user-agent': 'open-builder-score' } })
  if (!response.ok) throw new Error(`${explorer} returned ${response.status}`)
  const body = await response.json()
  if (body.status !== '1' || !Array.isArray(body.result)) {
    throw new Error(`${explorer} returned ${body.status}: ${body.message}`)
  }
  return body.result.map((log) => talentFromTopic(log.topics[1]))
}

async function main() {
  const perChain = {}
  const all = new Set()

  for (const factory of FACTORIES) {
    const talents = await fetchTalents(factory)
    perChain[factory.chain] = { factory: factory.address, events: talents.length }
    for (const talent of talents) all.add(talent)
    console.log(`${factory.chain}: ${talents.length} TalentCreated events`)
  }

  const payload = {
    slug: 'talent_token_launched',
    source: 'onchain history of the v1 TalentFactory (public, reproducible)',
    generator: 'scripts/build-talent-token-allowlist.mjs',
    frozen_because: 'both factories have been dormant since July 2023; Talent Protocol v1 is closed',
    chains: perChain,
    count: all.size,
    talents: [...all].sort(),
  }

  const dir = join(ROOT, 'spec', 'allowlists')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'talent-token-launched.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
  )
  console.log(`spec/allowlists/talent-token-launched.json — ${all.size} distinct talents`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
