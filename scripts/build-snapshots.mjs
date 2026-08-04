#!/usr/bin/env node
// Turns the raw exports from talent-api's script/export_obs_badge_snapshots.rb
// into the sharded files the app fetches, plus spec/snapshots.json.
//
//   node scripts/build-snapshots.mjs [--in=exports] [--date=YYYY-MM-DD]
//
// Every one of the 256 shards is written even when empty: the client treats a
// 404 as "couldn't check", so a missing shard has to mean a broken deploy and
// never "not earned".

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHARDS = 256
const EVM = /^0x[0-9a-f]{40}$/

const BADGES = [
  { slug: 'builder_score_100', file: 'builder_score_100.txt', threshold: 100 },
  { slug: 'builder_rewards_earned', file: 'builder_rewards_earned.txt' },
  // build_contributor is deliberately absent: $BUILD reads donated() live.
  // The export missed direct donors, because the only branch that saw them
  // was the build_contribution data point and that credential was retired.
  // Re-add it here only once that data point is back.
]

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function shardKeys() {
  return Array.from({ length: SHARDS }, (_, i) => i.toString(16).padStart(2, '0'))
}

function parseAddresses(text) {
  const addresses = new Set()
  let skipped = 0
  for (const line of text.split('\n')) {
    const value = line.trim().toLowerCase()
    if (value === '') continue
    if (!EVM.test(value)) {
      skipped += 1
      continue
    }
    addresses.add(value)
  }
  return { addresses: [...addresses], skipped }
}

async function writeBadge(slug, addresses) {
  const dir = join(ROOT, 'public', 'snapshots', slug)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const buckets = new Map(shardKeys().map((key) => [key, []]))
  for (const address of addresses) buckets.get(address.slice(2, 4)).push(address)

  await Promise.all(
    [...buckets].map(([key, members]) =>
      writeFile(join(dir, `${key}.json`), `${JSON.stringify(members.sort())}\n`),
    ),
  )
}

async function main() {
  const inDir = resolve(ROOT, arg('in', 'exports'))
  const generatedAt = arg('date', new Date().toISOString().slice(0, 10))
  const meta = {
    generated_at: generatedAt,
    source: 'talent-api script/export_obs_badge_snapshots.rb',
    shards: SHARDS,
    badges: {},
  }

  for (const badge of BADGES) {
    const path = join(inDir, badge.file)
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch {
      console.error(`missing export: ${path}`)
      console.error('run script/export_obs_badge_snapshots.rb in talent-api first')
      process.exit(1)
    }
    const { addresses, skipped } = parseAddresses(text)
    await writeBadge(badge.slug, addresses)
    meta.badges[badge.slug] = {
      count: addresses.length,
      ...(badge.threshold === undefined ? {} : { threshold: badge.threshold }),
    }
    console.log(
      `${badge.slug}: ${addresses.length} addresses across ${SHARDS} shards` +
        (skipped > 0 ? ` (${skipped} lines skipped — not EVM addresses)` : ''),
    )
  }

  await writeFile(join(ROOT, 'spec', 'snapshots.json'), `${JSON.stringify(meta, null, 2)}\n`)
  console.log(`spec/snapshots.json updated — generated_at ${generatedAt}`)
}

main()
