import { describe, expect, it } from 'vitest'
import specJson from '../spec/spec.json'
import { computeScore } from '@/lib/engine'
import {
  describeCalculation,
  describeValue,
  displayNote,
  formatFormula,
  groupCredentials,
} from '@/lib/credential-reference'
import type { Conversion, Spec, SpecCredential } from '@/lib/types'

const spec = specJson as Spec

function cred(over: Partial<SpecCredential>): SpecCredential {
  return {
    slug: 'fixture',
    name: 'Fixture',
    tier: 'rpc',
    value: 'nft_count',
    max_score: 10,
    multiplier: 2,
    conversion: 'no_conversion',
    calculation: 'max_value',
    poc: true,
    ...over,
  }
}

describe('groupCredentials', () => {
  it('returns the four scan sources in scan order', () => {
    const groups = groupCredentials(spec)
    expect(groups.map((g) => g.key)).toEqual(['chains', 'github', 'speedrun', 'verifiedBuilder'])
    expect(groups.map((g) => g.label)).toEqual([
      'Onchain badges & balances',
      'GitHub',
      'SpeedRun Ethereum',
      'EAS attestations',
    ])
  })

  it('covers exactly the active credentials, no dupes, none missing', () => {
    const grouped = groupCredentials(spec).flatMap((g) => g.credentials.map((c) => c.slug))
    const active = spec.credentials.filter((c) => c.poc).map((c) => c.slug)
    expect(grouped.length).toBe(active.length)
    expect(new Set(grouped)).toEqual(new Set(active))
  })

  it('group max totals sum to the engine maxTotal', () => {
    const groups = groupCredentials(spec)
    const summed = groups.reduce((n, g) => n + g.maxTotal, 0)
    const engine = computeScore({ computedAt: 0, values: {} }, spec)
    expect(summed).toBe(engine.maxTotal)
  })

  it('every group maxTotal is the sum of its credentials', () => {
    for (const g of groupCredentials(spec)) {
      expect(g.maxTotal).toBe(g.credentials.reduce((n, c) => n + c.max_score, 0))
    }
  })
})

describe('formatFormula', () => {
  it('renders each conversion in engine notation', () => {
    expect(formatFormula(cred({ conversion: 'no_conversion', multiplier: 2, max_score: 10 }))).toBe(
      'min(round(value × 2), 10)',
    )
    expect(formatFormula(cred({ conversion: 'sqrt', multiplier: 10, max_score: 20 }))).toBe(
      'min(round(sqrt(value) × 10), 20)',
    )
    expect(formatFormula(cred({ conversion: 'log', multiplier: 2, max_score: 10 }))).toBe(
      'min(round(ln(value) × 2), 10)',
    )
    expect(formatFormula(cred({ conversion: 'timestamp_to_year', multiplier: 1, max_score: 8 }))).toBe(
      'min(round(years × 1), 8)',
    )
  })

  it('throws on an unknown conversion', () => {
    expect(() => formatFormula(cred({ conversion: 'cubed' as Conversion }))).toThrow(/conversion/)
  })
})

describe('describeValue', () => {
  it('describes every value kind used by active credentials', () => {
    for (const c of spec.credentials.filter((c) => c.poc)) {
      expect(describeValue(c)).toBeTruthy()
    }
  })

  it('throws on an unknown value kind', () => {
    expect(() => describeValue(cred({ value: 'mystery_metric' }))).toThrow(/mystery_metric/)
  })
})

describe('describeCalculation', () => {
  it('labels both aggregation modes', () => {
    expect(describeCalculation(cred({ calculation: 'sum_all' }))).toBe('summed across wallets')
    expect(describeCalculation(cred({ calculation: 'max_value' }))).toBe('best wallet counts')
  })
})

describe('displayNote', () => {
  it('curates only the two user-relevant notes', () => {
    const noted = spec.credentials.filter((c) => c.poc && displayNote(c) !== null).map((c) => c.slug)
    expect(new Set(noted)).toEqual(new Set(['github_repositories', 'base_learn']))
  })
})
