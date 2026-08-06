import { describe, it, expect } from 'vitest'
import type { LatestAttestation } from '@/lib/latest'
import {
  ATTESTATIONS_PAGE_SIZE,
  paginateAttestations,
  sortAttestations,
} from '@/lib/attestations-table'

function row(
  partial: Partial<LatestAttestation> & Pick<LatestAttestation, 'uid'>,
): LatestAttestation {
  return {
    recipient: '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053',
    score: 100,
    specVersion: '0.3.0',
    walletCount: 1,
    timeCreated: 1_700_000_000,
    ...partial,
  }
}

describe('sortAttestations', () => {
  const items = [
    row({ uid: 'a', score: 50, timeCreated: 100 }),
    row({ uid: 'b', score: 200, timeCreated: 300 }),
    row({ uid: 'c', score: 100, timeCreated: 200 }),
  ]

  it('sorts by date descending by default use-case', () => {
    expect(sortAttestations(items, 'date', 'desc').map((r) => r.uid)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('sorts by date ascending', () => {
    expect(sortAttestations(items, 'date', 'asc').map((r) => r.uid)).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  it('sorts by score descending and ascending', () => {
    expect(sortAttestations(items, 'score', 'desc').map((r) => r.uid)).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(sortAttestations(items, 'score', 'asc').map((r) => r.uid)).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  it('does not mutate the input', () => {
    const copy = [...items]
    sortAttestations(items, 'score', 'asc')
    expect(items).toEqual(copy)
  })
})

describe('paginateAttestations', () => {
  const items = Array.from({ length: 23 }, (_, i) =>
    row({ uid: `u${i}`, score: i, timeCreated: i }),
  )

  it('uses page size 10 by default', () => {
    const page = paginateAttestations(items, 1)
    expect(page.items).toHaveLength(ATTESTATIONS_PAGE_SIZE)
    expect(page.from).toBe(1)
    expect(page.to).toBe(10)
    expect(page.total).toBe(23)
    expect(page.totalPages).toBe(3)
  })

  it('returns the second page and clamps past the end', () => {
    expect(paginateAttestations(items, 2).items.map((r) => r.uid)).toEqual(
      items.slice(10, 20).map((r) => r.uid),
    )
    expect(paginateAttestations(items, 99).page).toBe(3)
    expect(paginateAttestations(items, 0).page).toBe(1)
  })

  it('handles an empty list', () => {
    const page = paginateAttestations([], 1)
    expect(page).toEqual({
      page: 1,
      totalPages: 1,
      total: 0,
      items: [],
      from: 0,
      to: 0,
    })
  })
})
