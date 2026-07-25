import { describe, it, expect } from 'vitest'
import { scorePath, inputPath } from '@/lib/routes'

const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053'

describe('scorePath', () => {
  it('builds the results path without a handle', () => {
    expect(scorePath(WALLET, null)).toBe(`/score/${WALLET}`)
  })

  it('appends the github handle as a query param', () => {
    expect(scorePath(WALLET, 'octocat')).toBe(`/score/${WALLET}?github=octocat`)
  })

  it('treats empty and whitespace-only handles as absent', () => {
    expect(scorePath(WALLET, '')).toBe(`/score/${WALLET}`)
    expect(scorePath(WALLET, '   ')).toBe(`/score/${WALLET}`)
  })

  it('URL-encodes the handle', () => {
    expect(scorePath(WALLET, 'a b')).toBe(`/score/${WALLET}?github=a%20b`)
  })
})

describe('inputPath', () => {
  it('is bare /score with no prefill', () => {
    expect(inputPath(null, null)).toBe('/score')
  })

  it('carries wallet and github prefill params', () => {
    expect(inputPath(WALLET, 'octocat')).toBe(`/score?wallet=${WALLET}&github=octocat`)
  })

  it('omits empty values', () => {
    expect(inputPath(WALLET, '')).toBe(`/score?wallet=${WALLET}`)
    expect(inputPath('', 'octocat')).toBe('/score?github=octocat')
    expect(inputPath('  ', null)).toBe('/score')
  })
})
