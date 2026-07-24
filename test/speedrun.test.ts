import { describe, it, expect } from 'vitest'
import { countAcceptedChallenges } from '@/lib/speedrun'

describe('countAcceptedChallenges', () => {
  it('counts unique accepted challengeIds', () => {
    expect(
      countAcceptedChallenges({
        challenges: [
          { challengeId: 'simple-nft-example', reviewAction: 'ACCEPTED' },
          { challengeId: 'token-vendor', reviewAction: 'ACCEPTED' },
          { challengeId: 'token-vendor', reviewAction: 'ACCEPTED' },   // resubmission — dedupe
          { challengeId: 'dice-game', reviewAction: 'REJECTED' },
          { challengeId: null, reviewAction: 'ACCEPTED' },             // compact
        ],
      }),
    ).toBe(2)
  })

  it('returns 0 for an empty challenges array', () => {
    expect(countAcceptedChallenges({ challenges: [] })).toBe(0)
  })

  it('returns null when the payload has no challenges array', () => {
    expect(countAcceptedChallenges({})).toBeNull()
    expect(countAcceptedChallenges(null)).toBeNull()
    expect(countAcceptedChallenges({ challenges: 'nope' })).toBeNull()
  })
})
