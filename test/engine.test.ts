import { describe, it, expect } from 'vitest'
import specJson from '../spec/spec.json'
import type { Spec, EngineInputs, CredentialInput } from '@/lib/types'
import { computeScore, convert, round2 } from '@/lib/engine'

const spec = specJson as Spec
const YEAR = 31_536_000
const NOW = 1_753_401_600

const ok = (...accounts: number[]): CredentialInput => ({ status: 'ok', accounts })

// Hand-computed expected points in comments. The six excluded slugs are kept
// in the fixture on purpose: feeding the engine values it must not score is
// how we prove exclusion actually holds.
const goldenValues: Record<string, CredentialInput> = {
  eth_global_hacker: ok(2),                    // min(round(2×12), 12)  = 12
  eth_global_builder: ok(),                    // no accounts           = 0 (not_earned)
  eth_global_pioneer: ok(0),                   // 0×10                  = 0 (not_earned)
  eth_global_partner: ok(),                    //                       = 0
  eth_global_finalist: ok(1),                  // min(10, 10)           = 10
  devfolio_hackathons_participation: ok(9),    // sqrt(9)=3 ×10=30→20   = 20
  base_devfolio_hackathons_participation: ok(1), // sqrt(1)×10          = 10
  buidl_guidl_speedrun_ethereum: ok(4),        // 4×1                   = 4
  buidl_guidl_batches_graduate: ok(1),         // 1×20                  = 20
  talent_protocol_verified_builder: ok(2),     // 2×20=40→20            = 20
  // Read from the generated allowlist rather than a live call.
  devfolio_hackathons_won: ok(4),              // sqrt(4)=2 ×15         = 30
  base_devfolio_hackathons_won: ok(1),         // sqrt(1)=1 ×15         = 15
  base_basecamp: ok(2),                        // 2×20=40→20            = 20
  // Excluded — scored 7/12/0/3/1/0 = 23 points before the re-cut, 0 now.
  base_learn: ok(7),
  farcaster_farcon_nyc_2025_attendee: ok(1),
  crypto_nomads_club: ok(0),
  developer_dao_member: ok(150),
  talent_protocol_talent_holder: ok(900),
  talent_vault: ok(0),
  github_account_age: ok(NOW - 165_564_000),   // 5.25y ×1 → round      = 5
  github_followers: ok(170),                   // sqrt(170)≈13.04→13→6  = 6
  github_stars: ok(64),                        // sqrt(64)=8 ×0.5       = 4
  github_forks: ok(49),                        // sqrt(49)=7 ×2=14→12   = 12
  github_repositories: ok(16),                 // sqrt(16)=4 ×2=8       = 8
}

describe('convert', () => {
  it('no_conversion is identity', () => expect(convert('no_conversion', 7, NOW, YEAR)).toBe(7))
  it('sqrt', () => expect(convert('sqrt', 9, NOW, YEAR)).toBe(3))
  it('sqrt clamps negatives to 0', () => expect(convert('sqrt', -4, NOW, YEAR)).toBe(0))
  it('log is natural log', () => expect(convert('log', Math.E, NOW, YEAR)).toBeCloseTo(1))
  it('log clamps values <= 1 to 0', () => {
    expect(convert('log', 0, NOW, YEAR)).toBe(0)
    expect(convert('log', 1, NOW, YEAR)).toBe(0)
  })
  it('timestamp_to_year rounds to 2 decimals', () =>
    expect(convert('timestamp_to_year', NOW - 165_564_000, NOW, YEAR)).toBe(5.25))
  it('timestamp_to_year clamps future timestamps to 0', () =>
    expect(convert('timestamp_to_year', NOW + YEAR, NOW, YEAR)).toBe(0))
})

describe('computeScore — golden vector', () => {
  const result = computeScore({ computedAt: NOW, values: goldenValues }, spec)

  it('total is 196', () => expect(result.total).toBe(196))
  it('maxTotal is 196', () => expect(result.maxTotal).toBe(276))
  it('is complete', () => expect(result.complete).toBe(true))
  it('covers all 15 active credentials', () => expect(result.perCredential).toHaveLength(18))

  const points = Object.fromEntries(result.perCredential.map((r) => [r.slug, r.points]))
  it.each([
    ['eth_global_hacker', 12], ['eth_global_finalist', 10],
    ['devfolio_hackathons_participation', 20],
    ['base_devfolio_hackathons_participation', 10],
    ['buidl_guidl_batches_graduate', 20], ['talent_protocol_verified_builder', 20],
    ['github_account_age', 5], ['github_followers', 6], ['github_forks', 12],
  ])('%s = %i points', (slug, expected) => expect(points[slug]).toBe(expected))

  it('scores no excluded credential, even with a value supplied', () => {
    const scored = new Set(result.perCredential.map((r) => r.slug))
    for (const slug of [
      'base_learn',
      'farcaster_farcon_nyc_2025_attendee',
      'crypto_nomads_club',
      'developer_dao_member',
      'talent_protocol_talent_holder',
      'talent_vault',
    ]) {
      expect(scored.has(slug), `${slug} is excluded and must not be scored`).toBe(false)
    }
  })

  it('zero raw value is not_earned with 0 points', () => {
    const pioneer = result.perCredential.find((r) => r.slug === 'eth_global_pioneer')!
    expect(pioneer.points).toBe(0)
    expect(pioneer.state).toBe('not_earned')
  })

  it('empty accounts is not_earned with null raw', () => {
    const builder = result.perCredential.find((r) => r.slug === 'eth_global_builder')!
    expect(builder.state).toBe('not_earned')
    expect(builder.rawValue).toBeNull()
    expect(builder.formula).toBe('—')
  })

  it('renders an explainable formula string, clamp included', () => {
    const forks = result.perCredential.find((r) => r.slug === 'github_forks')!
    expect(forks.formula).toBe('min(round(sqrt(49) × 2), 12) = 12')
  })
})

describe('computeScore — calculation modes', () => {
  it('sum_all sums raw values BEFORE converting', () => {
    // github_forks: sqrt, ×2, max 12. Correct: sqrt(16+9)=5 → 10.
    // Wrong (convert-then-sum): sqrt(16)+sqrt(9)=7 → 14 → clamped 12.
    const r = computeScore(
      { computedAt: NOW, values: { ...goldenValues, github_forks: ok(16, 9) } },
      spec,
    )
    expect(r.perCredential.find((c) => c.slug === 'github_forks')!.points).toBe(10)
  })

  it('max_value converts per account and takes the best', () => {
    // devfolio: sqrt ×10 max 20. Accounts 1 → 10, 4 → 20. Best = 20.
    const r = computeScore(
      { computedAt: NOW, values: { ...goldenValues, devfolio_hackathons_participation: ok(1, 4) } },
      spec,
    )
    const c = r.perCredential.find((x) => x.slug === 'devfolio_hackathons_participation')!
    expect(c.points).toBe(20)
    expect(c.rawValue).toBe(4)
  })
})

describe('computeScore — unavailable propagation', () => {
  // Pioneer scores 0 in the golden vector, so the total is unchanged and this
  // isolates the completeness effect from the points effect.
  const values = {
    ...goldenValues,
    eth_global_pioneer: { status: 'unavailable', reason: 'RPC failed' } as CredentialInput,
  }
  const result = computeScore({ computedAt: NOW, values }, spec)

  it('keeps the total of the remaining credentials', () => expect(result.total).toBe(196))
  it('marks the result incomplete', () => expect(result.complete).toBe(false))
  it('carries the reason', () => {
    const pioneer = result.perCredential.find((r) => r.slug === 'eth_global_pioneer')!
    expect(pioneer.state).toBe('unavailable')
    expect(pioneer.points).toBe(0)
    expect(pioneer.unavailableReason).toBe('RPC failed')
  })

  it('an unavailable excluded credential cannot make a score incomplete', () => {
    const r = computeScore(
      {
        computedAt: NOW,
        values: {
          ...goldenValues,
          crypto_nomads_club: { status: 'unavailable', reason: 'RPC failed' } as CredentialInput,
        },
      },
      spec,
    )
    expect(r.complete).toBe(true)
    expect(r.total).toBe(196)
  })

  it('treats a missing slug as unavailable', () => {
    const { eth_global_hacker: _omitted, ...rest } = goldenValues
    const r = computeScore({ computedAt: NOW, values: rest }, spec)
    expect(r.complete).toBe(false)
    expect(r.perCredential.find((c) => c.slug === 'eth_global_hacker')!.state).toBe('unavailable')
  })
})

describe('round2', () => {
  it('rounds to 2 decimals', () => expect(round2(5.249999)).toBe(5.25))
})

describe('multi-account aggregation', () => {
  const miniSpec: Spec = {
    name: 'test',
    version: 'test',
    constants: { SECONDS_IN_A_YEAR: 31536000 },
    credentials: [
      { slug: 'sum_cred', name: 'Sum', tier: 'rpc', value: 'v', max_score: 100, multiplier: 1, conversion: 'no_conversion', calculation: 'sum_all', status: 'active' },
      { slug: 'max_cred', name: 'Max', tier: 'rpc', value: 'v', max_score: 100, multiplier: 1, conversion: 'no_conversion', calculation: 'max_value', status: 'active' },
    ],
  }
  it('sum_all sums accounts across wallets', () => {
    const result = computeScore(
      { computedAt: 1, values: { sum_cred: { status: 'ok', accounts: [2, 3] }, max_cred: { status: 'ok', accounts: [0] } } },
      miniSpec,
    )
    expect(result.perCredential.find((c) => c.slug === 'sum_cred')?.points).toBe(5)
    expect(result.perCredential.find((c) => c.slug === 'sum_cred')?.rawValue).toBe(5)
  })
  it('max_value takes the best account across wallets', () => {
    const result = computeScore(
      { computedAt: 1, values: { sum_cred: { status: 'ok', accounts: [0] }, max_cred: { status: 'ok', accounts: [7, 4] } } },
      miniSpec,
    )
    expect(result.perCredential.find((c) => c.slug === 'max_cred')?.points).toBe(7)
    expect(result.perCredential.find((c) => c.slug === 'max_cred')?.rawValue).toBe(7)
  })
})
