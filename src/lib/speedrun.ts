import type { CredentialInput } from './types'

const BASE_URL = 'https://speedrunethereum.com/api'

export function countAcceptedChallenges(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const challenges = (body as { challenges?: unknown }).challenges
  if (!Array.isArray(challenges)) return null
  const accepted = challenges
    .filter((c): c is { challengeId?: unknown; reviewAction?: unknown } =>
      typeof c === 'object' && c !== null)
    .filter((c) => c.reviewAction === 'ACCEPTED')
    .map((c) => c.challengeId)
    .filter((id): id is string => typeof id === 'string')
  return new Set(accepted).size
}

export async function readSpeedrunCredential(address: string): Promise<CredentialInput> {
  try {
    const response = await fetch(`${BASE_URL}/user-challenges/${address.toLowerCase()}`)
    if (!response.ok) {
      return { status: 'unavailable', reason: `SpeedRun Ethereum API error (${response.status})` }
    }
    const count = countAcceptedChallenges(await response.json())
    if (count === null) {
      return { status: 'unavailable', reason: 'SpeedRun Ethereum API returned an unexpected shape' }
    }
    return { status: 'ok', accounts: [count] }
  } catch {
    return { status: 'unavailable', reason: 'SpeedRun Ethereum API unreachable' }
  }
}
