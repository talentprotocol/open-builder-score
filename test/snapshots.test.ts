import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import badgeSpecJson from '../spec/badges.json'
import { readSnapshotBadge, shardKey, snapshotMeta, snapshotShardPath } from '@/lib/snapshots'
import { usesSnapshot } from '@/lib/badges'
import type { BadgeSpec, SnapshotMeta } from '@/lib/types'

const published: SnapshotMeta = { ...snapshotMeta, generated_at: '2026-07-28' }
const ADDRESS = '0xAbCdef0123456789012345678901234567890123'

function jsonResponse(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch
}

describe('shardKey', () => {
  it('takes the two hex characters after 0x, case-insensitively', () => {
    expect(shardKey(ADDRESS)).toBe('ab')
    expect(shardKey(ADDRESS.toLowerCase())).toBe('ab')
  })
  it('rejects anything that is not an EVM address', () => {
    expect(() => shardKey('0x123')).toThrow()
    expect(() => shardKey('vitalik.eth')).toThrow()
  })
  it('builds the shard path from the slug and the key', () => {
    expect(snapshotShardPath('builder_score_100', ADDRESS)).toBe(
      '/snapshots/builder_score_100/ab.json',
    )
  })
})

describe('readSnapshotBadge', () => {
  it('finds a member regardless of case', async () => {
    const fetchImpl = jsonResponse([ADDRESS.toLowerCase()])
    const result = await readSnapshotBadge('builder_score_100', ADDRESS, fetchImpl, published)
    expect(result).toEqual({ status: 'ok', earned: true })
  })

  it('reports a miss as not earned', async () => {
    const fetchImpl = jsonResponse([`0x${'9'.repeat(40)}`])
    expect(await readSnapshotBadge('builder_score_100', ADDRESS, fetchImpl, published)).toEqual({
      status: 'ok',
      earned: false,
    })
  })

  it('treats a missing shard as unavailable, not as not earned', async () => {
    const result = await readSnapshotBadge(
      'builder_score_100',
      ADDRESS,
      jsonResponse(null, 404),
      published,
    )
    expect(result).toEqual({ status: 'unavailable', reason: 'snapshot shard missing (404)' })
  })

  it('rejects a shard that is not an array', async () => {
    const result = await readSnapshotBadge(
      'builder_score_100',
      ADDRESS,
      jsonResponse({ nope: true }),
      published,
    )
    expect(result.status).toBe('unavailable')
  })

  it('survives a throwing fetch', async () => {
    const boom = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await readSnapshotBadge('builder_score_100', ADDRESS, boom, published)).toEqual({
      status: 'unavailable',
      reason: 'snapshot unreachable',
    })
  })

  it('does not fetch at all before the first export is published', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return { ok: true, status: 200, json: async () => [] } as Response
    }) as unknown as typeof fetch
    const result = await readSnapshotBadge('builder_score_100', ADDRESS, spy, {
      ...published,
      generated_at: null,
    })
    expect(called).toBe(false)
    expect(result).toEqual({ status: 'unavailable', reason: 'snapshot not published yet' })
  })
})

describe('published snapshot shards', () => {
  // usesSnapshot, not source === 'snapshot': a badge can have a snapshot as a
  // second check on top of a live read, and it still needs its shards.
  const snapshotSlugs = (badgeSpecJson as BadgeSpec).badges.filter(usesSnapshot).map((b) => b.slug)

  it('declares every snapshot badge in spec/snapshots.json', () => {
    for (const slug of snapshotSlugs) {
      expect(snapshotMeta.badges[slug], `${slug} missing from snapshots.json`).toBeDefined()
    }
  })

  // A 404 means "couldn't check", so once an export is published every shard
  // has to exist — including the empty ones.
  it.skipIf(!snapshotMeta.generated_at)('ships all 256 shards per badge', () => {
    for (const slug of snapshotSlugs) {
      for (let i = 0; i < 256; i++) {
        const key = i.toString(16).padStart(2, '0')
        const path = join(process.cwd(), 'public', 'snapshots', slug, `${key}.json`)
        expect(existsSync(path), `missing shard ${slug}/${key}.json`).toBe(true)
      }
    }
  })
})
