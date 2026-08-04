#!/usr/bin/env node
// Checks the generated NFT credential allowlists against Talent Protocol's own
// export, which is the only independent account of these numbers we have.
//
//   node scripts/verify-nft-credentials.mjs
//
// Reads exports/<slug>.csv (address,count) — produced by talent-api's
// script/export_obs_nft_credentials.rb — and compares it wallet by wallet
// against public/nft-credentials/<slug>/.
//
// The two are NOT expected to match exactly, and the differences are the
// point:
//
//   equal    the ordinary case.
//   higher   the rebuild found more. Expected everywhere: the export only
//            covers wallets attached to a Talent profile that has had a full
//            refresh (1.26% of wallet accounts), the chain covers everyone.
//   missing  in the export, absent from the chain. Expected in small numbers:
//            wallet_nfts is written with find_or_create_by and never deleted,
//            so it records "ever held" while the chain says "currently holds".
//            A wallet that sold or burned its token stays in the export.
//   lower    same cause as missing, for one token of several.
//
// So `missing` and `lower` are not automatically failures — but a large share
// of them is exactly what a truncated sweep looks like, which is how the
// Blockscout instances endpoint silently dropped a third of Encode's tokens.
// The threshold below is the alarm for that.

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXPORTS = join(ROOT, 'exports')
const BUILT = join(ROOT, 'public', 'nft-credentials')

// Above this share of export wallets unaccounted for, assume the build is
// wrong rather than the export stale, and fail.
const MISSING_LIMIT = 0.05

async function loadShards(slug) {
  const dir = join(BUILT, slug)
  const files = await readdir(dir)
  const values = new Map()
  for (const file of files) {
    const body = JSON.parse(await readFile(join(dir, file), 'utf8'))
    for (const [wallet, count] of Object.entries(body)) values.set(wallet, count)
  }
  return values
}

async function verify(slug) {
  const csv = (await readFile(join(EXPORTS, `${slug}.csv`), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => line.split(','))
    .filter((parts) => parts.length === 2)

  const built = await loadShards(slug)
  let equal = 0
  let higher = 0
  let lower = 0
  const missing = []

  for (const [wallet, raw] of csv) {
    const expected = Number(raw)
    const got = built.get(wallet)
    if (got === undefined) missing.push(wallet)
    else if (got > expected) higher++
    else if (got < expected) lower++
    else equal++
  }

  const share = csv.length ? missing.length / csv.length : 0
  const ok = share <= MISSING_LIMIT
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${slug.padEnd(34)} ` +
      `built=${String(built.size).padStart(5)}  export=${String(csv.length).padStart(5)}  ` +
      `equal=${equal} higher=${higher} lower=${lower} missing=${missing.length} (${(share * 100).toFixed(1)}%)`,
  )
  if (!ok) {
    console.log(`      ${missing.length} export wallets absent from the build, over the ${MISSING_LIMIT * 100}% limit.`)
    console.log(`      Sample: ${missing.slice(0, 3).join(', ')}`)
    console.log('      Check these on chain before assuming the export is merely stale:')
    console.log('      a wallet that still holds the token means the sweep was short.')
  }
  return ok
}

async function main() {
  const slugs = Object.keys(
    JSON.parse(await readFile(join(ROOT, 'spec', 'nft-credentials.json'), 'utf8')).credentials,
  ).sort()

  let allOk = true
  for (const slug of slugs) {
    try {
      allOk = (await verify(slug)) && allOk
    } catch (error) {
      console.log(`SKIP  ${slug.padEnd(34)} ${error.message}`)
    }
  }
  if (!allOk) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
