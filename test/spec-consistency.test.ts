import { describe, it, expect } from 'vitest'
import specJson from '../spec/spec.json'
import registryJson from '../spec/badge-registry.json'
import badgeSpecJson from '../spec/badges.json'
import type { Spec, Registry, BadgeSpec } from '@/lib/types'

const spec = specJson as Spec
const registry = registryJson as unknown as Registry
const badgeSpec = badgeSpecJson as BadgeSpec

const activeSlugs = spec.credentials.filter((c) => c.status === 'active').map((c) => c.slug)

describe('spec.json', () => {
  it('has 15 active credentials', () => {
    expect(activeSlugs).toHaveLength(15)
  })

  // Pinned so that adding a badge can never quietly widen the score. Badges
  // are zero-point; if this number moves, something entered the scoring
  // contract that should not have.
  it('still tops out at 196 points', () => {
    const maxTotal = spec.credentials
      .filter((c) => c.status === 'active')
      .reduce((sum, c) => sum + c.max_score, 0)
    expect(maxTotal).toBe(196)
  })

  // Pinned so that re-admitting one of these is a deliberate edit rather than
  // a side effect. These are computable — they are out because they score
  // attendance, membership, a buyable balance, or testnet activity.
  it('excludes exactly the six non-building credentials', () => {
    const excluded = spec.credentials.filter((c) => c.status === 'excluded').map((c) => c.slug)
    expect(excluded.sort()).toEqual(
      [
        'base_learn',
        'crypto_nomads_club',
        'developer_dao_member',
        'farcaster_farcon_nyc_2025_attendee',
        'talent_protocol_talent_holder',
        'talent_vault',
      ].sort(),
    )
  })

  it('gives every uncounted credential a reason', () => {
    for (const c of spec.credentials) {
      expect(['active', 'deferred', 'excluded']).toContain(c.status)
      if (c.status !== 'active') {
        expect(c.status_reason, `${c.slug} needs a status_reason`).toBeTruthy()
      }
    }
  })

  it('uses only known conversions and calculations', () => {
    for (const c of spec.credentials) {
      expect(['no_conversion', 'sqrt', 'log', 'timestamp_to_year']).toContain(c.conversion)
      expect(['sum_all', 'max_value']).toContain(c.calculation)
      expect(c.max_score).toBeGreaterThan(0)
      expect(c.multiplier).toBeGreaterThan(0)
    }
  })

  it('pins SECONDS_IN_A_YEAR to the production constant', () => {
    expect(spec.constants.SECONDS_IN_A_YEAR).toBe(31_536_000)
  })
})

describe('badge-registry.json', () => {
  // Excluded credentials keep their registry entries on purpose — the
  // contracts stay documented, and nothing reads them because orchestrate
  // builds its slug set from active alone.
  const rpcSlugs = spec.credentials
    .filter((c) => c.status !== 'deferred' && c.tier === 'rpc')
    .map((c) => c.slug)

  it('covers every scored and excluded rpc credential with a contracts array', () => {
    for (const slug of rpcSlugs) {
      const entry = registry.credentials[slug]
      expect(entry, `missing registry entry for ${slug}`).toBeDefined()
      expect(Array.isArray(entry.contracts), `${slug} needs a contracts array`).toBe(true)
    }
  })

  it('has valid addresses and known chains on every contract', () => {
    for (const [slug, entry] of Object.entries(registry.credentials)) {
      if (!Array.isArray(entry.contracts)) continue
      for (const contract of entry.contracts) {
        expect(contract.address, `${slug}/${contract.name}`).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(registry.chains[contract.chain], `${slug} unknown chain ${contract.chain}`).toBeDefined()
      }
    }
  })

  it('has the talent_vault call config', () => {
    const vault = registry.credentials.talent_vault
    expect(vault.call).toEqual({
      function: 'userBalanceMeta(address)',
      result_index: 0,
      divide_by: '1e18',
    })
  })

  it('keeps badge slugs distinct from credential slugs', () => {
    // Both render as `id={slug}` anchors on /credentials, and a collision
    // would silently point the deep link at the wrong card.
    const credentialSlugs = new Set(spec.credentials.map((c) => c.slug))
    for (const badge of badgeSpec.badges) {
      expect(credentialSlugs.has(badge.slug), `${badge.slug} collides`).toBe(false)
    }
  })

  it('has the verified_builder schema uid on base+celo', () => {
    const vb = registry.credentials.talent_protocol_verified_builder
    expect(vb.schema_uid).toBe('0x597905068aedcde4321ceaf2c42e24d3bbe0af694159bececd686bf057ec7ea5')
    expect(vb.networks).toEqual(['base-mainnet', 'celo-mainnet'])
  })
})
