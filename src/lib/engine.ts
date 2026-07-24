import type {
  Calculation,
  Conversion,
  CredentialInput,
  CredentialResult,
  EngineInputs,
  ScoreResult,
  Spec,
  SpecCredential,
} from './types'

export function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export function convert(
  conversion: Conversion,
  value: number,
  computedAt: number,
  secondsInAYear: number,
): number {
  switch (conversion) {
    case 'no_conversion':
      return value
    case 'sqrt':
      return value <= 0 ? 0 : Math.sqrt(value)
    case 'log':
      return value <= 1 ? 0 : Math.log(value)
    case 'timestamp_to_year':
      return Math.max(0, round2((computedAt - value) / secondsInAYear))
  }
}

function clampPoints(candidate: number, maxScore: number): number {
  return Math.max(0, Math.min(Math.round(candidate), maxScore))
}

function formatConverted(conversion: Conversion, rawValue: number, converted: number): string {
  switch (conversion) {
    case 'sqrt':
      return `sqrt(${rawValue})`
    case 'log':
      return `ln(${rawValue})`
    case 'timestamp_to_year':
      return `${converted}y`
    case 'no_conversion':
      return `${rawValue}`
  }
}

function scoreCredential(
  c: SpecCredential,
  input: CredentialInput,
  computedAt: number,
  secondsInAYear: number,
): CredentialResult {
  const base = { slug: c.slug, name: c.name, maxScore: c.max_score }

  if (input.status === 'unavailable') {
    return {
      ...base,
      points: 0,
      rawValue: null,
      converted: null,
      formula: '—',
      state: 'unavailable',
      unavailableReason: input.reason,
    }
  }

  if (input.accounts.length === 0) {
    return { ...base, points: 0, rawValue: null, converted: null, formula: '—', state: 'not_earned' }
  }

  let rawValue: number
  let converted: number
  if (c.calculation === ('sum_all' satisfies Calculation)) {
    rawValue = input.accounts.reduce((a, b) => a + b, 0)
    converted = convert(c.conversion, rawValue, computedAt, secondsInAYear)
  } else {
    // max_value: convert × multiply per account, take the best account
    let best = { raw: input.accounts[0], converted: 0, candidate: -Infinity }
    for (const raw of input.accounts) {
      const conv = convert(c.conversion, raw, computedAt, secondsInAYear)
      const candidate = conv * c.multiplier
      if (candidate > best.candidate) best = { raw, converted: conv, candidate }
    }
    rawValue = best.raw
    converted = best.converted
  }

  const points = clampPoints(converted * c.multiplier, c.max_score)
  const formula = `min(round(${formatConverted(c.conversion, rawValue, converted)} × ${c.multiplier}), ${c.max_score}) = ${points}`
  return {
    ...base,
    points,
    rawValue,
    converted,
    formula,
    state: points > 0 ? 'earned' : 'not_earned',
  }
}

export function computeScore(inputs: EngineInputs, spec: Spec): ScoreResult {
  const pocCredentials = spec.credentials.filter((c) => c.poc)
  const perCredential = pocCredentials.map((c) =>
    scoreCredential(
      c,
      inputs.values[c.slug] ?? { status: 'unavailable', reason: 'not fetched' },
      inputs.computedAt,
      spec.constants.SECONDS_IN_A_YEAR,
    ),
  )
  return {
    total: perCredential.reduce((sum, r) => sum + r.points, 0),
    maxTotal: pocCredentials.reduce((sum, c) => sum + c.max_score, 0),
    perCredential,
    complete: perCredential.every((r) => r.state !== 'unavailable'),
  }
}
