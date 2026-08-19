import { describe, it, expect } from 'vitest'
import type { LatestAttestation } from '@/lib/latest'
import { buildLeaderboard, LEADERBOARD_SIZE } from '@/lib/leaderboard'

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

describe('buildLeaderboard', () => {
  it('keeps only the newest attestation per recipient', () => {
    const items = [
      row({ uid: 'old', recipient: '0xAAA', score: 900, timeCreated: 100 }),
      row({ uid: 'new', recipient: '0xAAA', score: 300, timeCreated: 200 }),
    ]
    const board = buildLeaderboard(items)
    expect(board.map((r) => r.uid)).toEqual(['new'])
  })

  it('dedupes recipients case-insensitively', () => {
    const items = [
      row({ uid: 'lower', recipient: '0xabc', score: 500, timeCreated: 100 }),
      row({ uid: 'upper', recipient: '0xABC', score: 400, timeCreated: 200 }),
    ]
    expect(buildLeaderboard(items).map((r) => r.uid)).toEqual(['upper'])
  })

  it('ranks by score descending', () => {
    const items = [
      row({ uid: 'mid', recipient: '0x1', score: 400 }),
      row({ uid: 'top', recipient: '0x2', score: 800 }),
      row({ uid: 'low', recipient: '0x3', score: 100 }),
    ]
    expect(buildLeaderboard(items).map((r) => r.uid)).toEqual(['top', 'mid', 'low'])
  })

  it('breaks score ties by earlier attestation first', () => {
    const items = [
      row({ uid: 'later', recipient: '0x1', score: 500, timeCreated: 300 }),
      row({ uid: 'earlier', recipient: '0x2', score: 500, timeCreated: 100 }),
    ]
    expect(buildLeaderboard(items).map((r) => r.uid)).toEqual(['earlier', 'later'])
  })

  it('caps the board at LEADERBOARD_SIZE rows', () => {
    const items = Array.from({ length: LEADERBOARD_SIZE + 5 }, (_, i) =>
      row({ uid: `u${i}`, recipient: `0x${i}`, score: i }),
    )
    expect(buildLeaderboard(items)).toHaveLength(LEADERBOARD_SIZE)
  })

  it('returns an empty board for no attestations', () => {
    expect(buildLeaderboard([])).toEqual([])
  })
})
