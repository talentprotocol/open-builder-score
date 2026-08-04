import { describe, expect, it } from 'vitest'
import specJson from '../spec/spec.json'
import { computeScore } from '@/lib/engine'
import {
  describeCalculation,
  describeValue,
  displayNote,
  formatFormula,
  groupCredentials,
  scannedChainCount,
  statusReason,
  uncountedCredentials,
} from '@/lib/credential-reference'
import { buildChainPlan } from '@/lib/chains'
import registryJson from '../spec/badge-registry.json'
import type { Calculation, Conversion, Registry, Spec, SpecCredential } from '@/lib/types'

const spec = specJson as Spec
const registry = registryJson as unknown as Registry

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
    status: 'active',
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
    const active = spec.credentials.filter((c) => c.status === 'active').map((c) => c.slug)
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

  it('renders a well-formed formula for every active credential', () => {
    for (const c of spec.credentials.filter((c) => c.status === 'active')) {
      expect(formatFormula(c)).toMatch(/^min\(round\(.+ × .+\), \d+\)$/)
    }
  })
})

describe('describeValue', () => {
  it('describes every value kind used by active credentials', () => {
    for (const c of spec.credentials.filter((c) => c.status === 'active')) {
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

  it('has no label for single-handle GitHub credentials', () => {
    expect(describeCalculation(cred({ tier: 'github_public', calculation: 'sum_all' }))).toBeNull()
  })

  it('throws on an unknown calculation', () => {
    expect(() => describeCalculation(cred({ calculation: 'median' as Calculation }))).toThrow(
      /calculation/,
    )
  })
})

describe('scannedChainCount', () => {
  // The UI copy derives from this rather than from buildChainPlan, to keep
  // viem out of the landing bundle — so the two have to be pinned together.
  it('matches the chain set the planner actually dials', () => {
    const activeRpcSlugs = new Set(
      spec.credentials.filter((c) => c.status === 'active' && c.tier === 'rpc').map((c) => c.slug),
    )
    expect(scannedChainCount(spec)).toBe(buildChainPlan(registry, activeRpcSlugs).length)
  })

  it('is 4 after the re-cut, down from 6', () => {
    expect(scannedChainCount(spec)).toBe(4)
  })
})

describe('uncountedCredentials', () => {
  it('lists excluded before deferred, and nothing that is scored', () => {
    const groups = uncountedCredentials(spec)
    expect(groups.map((g) => g.status)).toEqual(['excluded', 'deferred'])
    const listed = groups.flatMap((g) => g.credentials.map((c) => c.slug))
    const scored = new Set(groupCredentials(spec).flatMap((g) => g.credentials.map((c) => c.slug)))
    for (const slug of listed) expect(scored.has(slug)).toBe(false)
  })

  it('accounts for every credential exactly once, counted or not', () => {
    const counted = groupCredentials(spec).flatMap((g) => g.credentials.map((c) => c.slug))
    const uncounted = uncountedCredentials(spec).flatMap((g) => g.credentials.map((c) => c.slug))
    expect([...counted, ...uncounted].sort()).toEqual(spec.credentials.map((c) => c.slug).sort())
  })

  it('gives a reason for every uncounted credential', () => {
    for (const g of uncountedCredentials(spec)) {
      for (const c of g.credentials) expect(statusReason(c)).toBeTruthy()
    }
  })

  it('refuses to invent a reason for a scored credential', () => {
    expect(() => statusReason(cred({ status: 'active' }))).toThrow(/active/)
    expect(() => statusReason(cred({ status: 'excluded' }))).toThrow(/status_reason/)
  })
})

describe('displayNote', () => {
  it('curates only the user-relevant notes', () => {
    const noted = spec.credentials.filter((c) => c.status === 'active' && displayNote(c) !== null).map((c) => c.slug)
    expect(new Set(noted)).toEqual(new Set(['github_repositories']))
  })
})
