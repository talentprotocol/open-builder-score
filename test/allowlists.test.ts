import { describe, it, expect } from 'vitest'
import badgeSpecJson from '../spec/badges.json'
import { allowlists, readAllowlistBadge } from '@/lib/allowlists'
import type { BadgeSpec } from '@/lib/types'

const badgeSpec = badgeSpecJson as BadgeSpec
const talentTokens = allowlists['talent-token-launched']

describe('readAllowlistBadge', () => {
  it('matches a member regardless of case', () => {
    const member = talentTokens.talents[0]
    expect(readAllowlistBadge('talent-token-launched', member)).toEqual({
      status: 'ok',
      earned: true,
    })
    expect(readAllowlistBadge('talent-token-launched', member.toUpperCase().replace('0X', '0x')))
      .toEqual({ status: 'ok', earned: true })
  })

  it('reports a non-member as not earned', () => {
    expect(readAllowlistBadge('talent-token-launched', `0x${'9'.repeat(40)}`)).toEqual({
      status: 'ok',
      earned: false,
    })
  })

  it('reports an unknown allowlist as unavailable rather than not earned', () => {
    expect(readAllowlistBadge('nope', `0x${'9'.repeat(40)}`)).toEqual({
      status: 'unavailable',
      reason: 'unknown allowlist: nope',
    })
  })
})

describe('the talent-token-launched allowlist', () => {
  it('is wired to the badge that names it', () => {
    const badge = badgeSpec.badges.find((b) => b.slug === 'talent_token_launched')
    expect(badge?.source).toBe('allowlist')
    expect(allowlists[badge!.allowlist!]).toBeDefined()
  })

  it('holds only lowercased EVM addresses, deduped and sorted', () => {
    const { talents } = talentTokens
    for (const address of talents) expect(address).toMatch(/^0x[0-9a-f]{40}$/)
    expect(new Set(talents).size).toBe(talents.length)
    expect([...talents].sort()).toEqual(talents)
    expect(talents.length).toBe(talentTokens.count)
  })

  it('covers both factories, Celo included', () => {
    // The Celo cohort is the whole point: a Polygon-only live read would have
    // matched 20 of these and silently missed the rest.
    expect(Object.keys(talentTokens.chains).sort()).toEqual(['celo-mainnet', 'polygon-mainnet'])
    expect(talentTokens.chains['celo-mainnet'].events).toBeGreaterThan(500)
    expect(talentTokens.count).toBeGreaterThan(500)
  })

  it('contains wallets verified against the live factories', () => {
    // Spot-checked on 2026-07-28: the Celo wallet through its TalentCreated
    // receipt + tokensToTalents, the Polygon ones through talentsToTokens.
    for (const address of [
      '0x858d77889aff132cbedfb6a6943b87eb3bf42ff0', // Celo
      '0x5bb3e9a39db9034b977c80b1973855e813dd1a03', // Polygon
      '0x3efba65a001f2b338ffdee20b1f3fec609a979fe', // Polygon
    ]) {
      expect(talentTokens.talents, `${address} missing`).toContain(address)
    }
  })
})
