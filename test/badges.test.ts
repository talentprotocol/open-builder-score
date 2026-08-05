import { describe, it, expect } from 'vitest'
import {
  badgeChecks,
  badgeDefinitions,
  badgeEvidence,
  classifyAttestedBadges,
  evaluateBadges,
  gatherBadges,
  usesSnapshot,
} from '@/lib/badges'
import { mergeBadgeInputs } from '@/lib/badge-reads'
import type { BadgeInput, BadgeSpec } from '@/lib/types'

const earned: BadgeInput = { status: 'ok', earned: true }
const missing: BadgeInput = { status: 'ok', earned: false }
const broken: BadgeInput = { status: 'unavailable', reason: 'rpc down' }

const spec: BadgeSpec = {
  version: 'test',
  badges: [
    {
      slug: 'live_one',
      name: 'Live One',
      description: 'a live badge',
      source: 'rpc',
      method: 'positive_uint_call',
      call: 'donated(address)',
      contracts: [{ name: 'X', chain: 'base-mainnet', address: `0x${'1'.repeat(40)}` }],
    },
    { slug: 'snap_one', name: 'Snap One', description: 'a snapshot badge', source: 'snapshot' },
    {
      slug: 'list_one',
      name: 'List One',
      description: 'an allowlist badge',
      source: 'allowlist',
      allowlist: 'some-list',
    },
    {
      slug: 'dual_one',
      name: 'Dual One',
      description: 'a live read plus a snapshot',
      source: 'rpc',
      method: 'positive_uint_call',
      call: 'donated(address)',
      contracts: [{ name: 'X', chain: 'base-mainnet', address: `0x${'2'.repeat(40)}` }],
      snapshot: true,
    },
  ],
}

const A = `0x${'a'.repeat(40)}` as `0x${string}`
const B = `0x${'b'.repeat(40)}` as `0x${string}`

describe('mergeBadgeInputs', () => {
  it('is an OR: any earned wins', () => {
    expect(mergeBadgeInputs(missing, earned)).toEqual(earned)
    expect(mergeBadgeInputs(earned, missing)).toEqual(earned)
  })

  it('lets an earned read beat a failed one', () => {
    // One flaky chain must not hide a badge another chain already proved.
    expect(mergeBadgeInputs(broken, earned)).toEqual(earned)
    expect(mergeBadgeInputs(earned, broken)).toEqual(earned)
  })

  it('reports unavailable only when nothing was earned', () => {
    expect(mergeBadgeInputs(broken, missing)).toEqual(broken)
    expect(mergeBadgeInputs(missing, missing)).toEqual(missing)
  })
})

describe('evaluateBadges', () => {
  it('maps inputs onto the three states', () => {
    const results = evaluateBadges({ live_one: earned, snap_one: missing }, spec, '2026-07-28')
    expect(results.map((r) => r.state)).toEqual([
      'earned',
      'not_earned',
      'unavailable',
      'unavailable',
    ])
  })

  it('marks a badge unavailable when it was never checked', () => {
    const [live] = evaluateBadges({}, spec, null)
    expect(live.state).toBe('unavailable')
    expect(live.unavailableReason).toBe('not checked')
  })

  it('carries the export date on snapshot badges only', () => {
    const [live, snap] = evaluateBadges({ live_one: earned, snap_one: earned }, spec, '2026-07-28')
    expect(live.asOf).toBeUndefined()
    expect(snap.asOf).toBe('2026-07-28')
  })

  it('covers every badge in the spec, in spec order', () => {
    expect(evaluateBadges({}, spec, null).map((r) => r.slug)).toEqual([
      'live_one',
      'snap_one',
      'list_one',
      'dual_one',
    ])
  })
})

describe('gatherBadges', () => {
  it('ORs across wallets: one wallet earning is enough', async () => {
    const results = await gatherBadges(
      [A, B],
      {
        rpc: async (address) => ({ live_one: address === B ? earned : missing }),
        snapshot: async (_slug, address) => (address === A ? earned : missing),
        allowlist: (_name, address) => (address === B ? earned : missing),
      },
      spec,
      '2026-07-28',
    )
    expect(results.map((r) => [r.slug, r.state])).toEqual([
      ['live_one', 'earned'],
      ['snap_one', 'earned'],
      ['list_one', 'earned'],
      ['dual_one', 'earned'],
    ])
  })

  it('passes the allowlist name, not the badge slug, to the fetcher', async () => {
    const names: string[] = []
    await gatherBadges(
      [A],
      {
        rpc: async () => ({}),
        snapshot: async () => missing,
        allowlist: (name) => {
          names.push(name)
          return missing
        },
      },
      spec,
      null,
    )
    expect(names).toEqual(['some-list'])
  })

  it('marks an allowlist badge unavailable when it names no list', async () => {
    const broken_spec: BadgeSpec = {
      version: 'test',
      badges: [{ slug: 'list_two', name: 'L2', description: 'd', source: 'allowlist' }],
    }
    const [result] = await gatherBadges(
      [A],
      { rpc: async () => ({}), snapshot: async () => missing },
      broken_spec,
      null,
    )
    expect(result.state).toBe('unavailable')
  })

  it('keeps a badge earned when another wallet failed to read', async () => {
    const results = await gatherBadges(
      [A, B],
      {
        rpc: async (address) => ({ live_one: address === A ? earned : broken }),
        snapshot: async () => missing,
      },
      spec,
      null,
    )
    expect(results[0].state).toBe('earned')
  })

  it('falls back to unavailable when every wallet failed', async () => {
    const results = await gatherBadges(
      [A, B],
      { rpc: async () => ({ live_one: broken }), snapshot: async () => missing },
      spec,
      null,
    )
    expect(results[0]).toMatchObject({ state: 'unavailable', unavailableReason: 'rpc down' })
  })

  it('asks the snapshot fetcher once per badge per wallet', async () => {
    const calls: string[] = []
    await gatherBadges(
      [A, B],
      {
        rpc: async () => ({}),
        snapshot: async (slug, address) => {
          calls.push(`${slug}:${address}`)
          return missing
        },
      },
      spec,
      null,
    )
    expect([...calls].sort()).toEqual([
      `dual_one:${A}`,
      `dual_one:${B}`,
      `snap_one:${A}`,
      `snap_one:${B}`,
    ])
  })

  it('rejects an empty address list', async () => {
    await expect(gatherBadges([], {}, spec, null)).rejects.toThrow()
  })
})

// No shipped badge carries two checks any more — $BUILD dropped its export —
// but the fold has to stay correct for the day one does: either check earning
// must be enough, and a second check must never overwrite what the first
// found. Covered here off the fixture spec's dual_one.
describe('badges with more than one check', () => {
  const dual = spec.badges.find((b) => b.slug === 'dual_one')!

  it('lists both checks, live read first', () => {
    expect(badgeChecks(dual)).toEqual(['rpc', 'snapshot'])
    expect(usesSnapshot(dual)).toBe(true)
  })

  it('counts a badge as snapshot-backed even when its source is rpc', () => {
    const [, , , result] = evaluateBadges({ dual_one: earned }, spec, '2026-07-31')
    expect(result.slug).toBe('dual_one')
    expect(result.asOf).toBe('2026-07-31')
  })

  const gatherDual = (rpcInput: BadgeInput, snapshotInput: BadgeInput) =>
    gatherBadges(
      [A],
      {
        rpc: async () => ({ dual_one: rpcInput }),
        snapshot: async () => snapshotInput,
        allowlist: () => missing,
      },
      spec,
      null,
    ).then((results) => results.find((r) => r.slug === 'dual_one')!)

  it('earns from the onchain read alone', async () => {
    expect((await gatherDual(earned, missing)).state).toBe('earned')
  })

  it('earns from the snapshot alone', async () => {
    // The regression that matters: the snapshot used to overwrite the rpc
    // result rather than fold into it.
    expect((await gatherDual(missing, earned)).state).toBe('earned')
  })

  it('stays not-earned when neither check finds it', async () => {
    expect((await gatherDual(missing, missing)).state).toBe('not_earned')
  })

  it('still earns when one check is broken and the other finds it', async () => {
    expect((await gatherDual(broken, earned)).state).toBe('earned')
    expect((await gatherDual(earned, broken)).state).toBe('earned')
  })

  it('is unavailable when a check fails and nothing else earned it', async () => {
    expect((await gatherDual(missing, broken)).state).toBe('unavailable')
  })
})

describe('classifyAttestedBadges', () => {
  // An attestation records badge slugs but not which check earned them, so the
  // verifier can only classify by what the badge *could* rest on. Three of the
  // four touch a dated Talent Protocol export, and claiming otherwise would put
  // an unfalsifiable label next to an unverifiable claim.
  const evidenceOf = (slug: string) => classifyAttestedBadges([slug])[0].evidence

  it('calls a badge public only when no check can rest on an export', () => {
    // The allowlist is rebuilt from TalentCreated events on Celo and Polygon —
    // public chain history anyone can re-derive.
    expect(evidenceOf('talent_token_launched')).toBe('public')
    // $BUILD qualifies too: donated() is a permissionless read.
    expect(evidenceOf('build_contributor')).toBe('public')
  })

  it('calls an OR-ed badge mixed, because the record does not say which branch fired', () => {
    // No shipped badge is mixed: $BUILD dropped its export after that export
    // was found to miss direct donors. The branch is covered off the fixture
    // spec, where dual_one ORs a live read with a snapshot — calling such a
    // badge 'public' would overclaim for anyone who earned it via the export.
    expect(classifyAttestedBadges(['dual_one'], spec)[0].evidence).toBe('mixed')
  })

  it('calls snapshot-only badges export', () => {
    expect(evidenceOf('builder_score_100')).toBe('export')
    expect(evidenceOf('builder_rewards_earned')).toBe('export')
  })

  it('calls $BUILD public now that it rests on the live read alone', () => {
    expect(evidenceOf('build_contributor')).toBe('public')
  })

  it('carries the display name through and keeps the attested order', () => {
    const out = classifyAttestedBadges(['builder_score_100', 'talent_token_launched'])
    expect(out.map((b) => b.slug)).toEqual(['builder_score_100', 'talent_token_launched'])
    expect(out[1].name).toBe('Launched a Talent Token')
  })

  it('treats an unknown slug as export — the cautious end, and keeps it visible', () => {
    const [unknown] = classifyAttestedBadges(['not_a_real_badge'])
    expect(unknown).toMatchObject({ slug: 'not_a_real_badge', name: 'not_a_real_badge', evidence: 'export' })
  })
})

describe('badgeEvidence', () => {
  // The verify screen labels an attested badge off this, so every shipped
  // badge has to land on one of the three classes — an unclassifiable badge
  // would render with no provenance at all.
  it('classifies every badge in the spec', () => {
    for (const badge of badgeDefinitions) {
      expect(['public', 'mixed', 'export'], `${badge.slug} unclassified`).toContain(
        badgeEvidence(badge),
      )
    }
  })
})
