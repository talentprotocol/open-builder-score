import { describe, it, expect } from 'vitest'
import spec from '../spec/spec.json'
import { FORMULA_LINES, alt, contentType, size } from '@/app/opengraph-image'

describe('opengraph image', () => {
  it('prints the spec formula, only wrapped', () => {
    // The card hand-wraps scoring.per_credential across four lines to fit the
    // code block. Unwrapping has to give the spec's string back verbatim, so a
    // formula change in spec.json fails here instead of shipping a stale card.
    // Compared without whitespace: wrapping and indenting is the only licence
    // the card takes, plus the typographic × standing in for the spec's *.
    const unwrapped = FORMULA_LINES.join('').replaceAll('×', '*').replace(/\s/g, '')
    const expected = spec.scoring.per_credential.replace(/\s/g, '')

    expect(unwrapped).toBe(expected)
  })

  it('is a 1200x630 png, the size X renders a large summary card at', () => {
    expect(size).toEqual({ width: 1200, height: 630 })
    expect(contentType).toBe('image/png')
  })

  it('describes the card in its alt text', () => {
    expect(alt).toContain('talentprotocol.com')
  })
})
