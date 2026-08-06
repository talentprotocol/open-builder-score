import type { LatestAttestation } from './latest'

export type AttestationSortKey = 'date' | 'score'
export type AttestationSortDir = 'asc' | 'desc'

export const ATTESTATIONS_PAGE_SIZE = 10

export function sortAttestations(
  items: LatestAttestation[],
  key: AttestationSortKey,
  dir: AttestationSortDir,
): LatestAttestation[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const av = key === 'date' ? a.timeCreated : a.score
    const bv = key === 'date' ? b.timeCreated : b.score
    if (av === bv) return 0
    return av < bv ? -sign : sign
  })
}

export interface AttestationPage {
  page: number
  totalPages: number
  total: number
  items: LatestAttestation[]
  from: number
  to: number
}

export function paginateAttestations(
  items: LatestAttestation[],
  page: number,
  pageSize: number = ATTESTATIONS_PAGE_SIZE,
): AttestationPage {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  const slice = items.slice(start, start + pageSize)
  return {
    page: safePage,
    totalPages,
    total,
    items: slice,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
  }
}
