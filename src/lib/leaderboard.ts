import type { LatestAttestation } from './latest'

export const LEADERBOARD_SIZE = 10

// Far above today's total attestation count; the board sees every wallet
// until volume outgrows one page, at which point this becomes a sample.
export const LEADERBOARD_TAKE = 200

// A wallet's row is its newest attestation (the score it currently claims),
// not its highest-ever — a re-attest after a score drop moves it down.
// Ties rank the earlier attester first.
export function buildLeaderboard(items: LatestAttestation[]): LatestAttestation[] {
  const newestByRecipient = new Map<string, LatestAttestation>()
  for (const item of items) {
    const key = item.recipient.toLowerCase()
    const current = newestByRecipient.get(key)
    if (!current || item.timeCreated > current.timeCreated) {
      newestByRecipient.set(key, item)
    }
  }
  return [...newestByRecipient.values()]
    .sort((a, b) => b.score - a.score || a.timeCreated - b.timeCreated)
    .slice(0, LEADERBOARD_SIZE)
}
