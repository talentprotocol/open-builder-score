import { getAddress } from 'viem'
import registryJson from '../../spec/badge-registry.json'
import type { CredentialInput, Registry } from './types'

const registry = registryJson as unknown as Registry

const ENDPOINTS = [
  'https://base.easscan.org/graphql',
  'https://celo.easscan.org/graphql',
]

// Mirrors talent-api lib/eas_scan_graphql/queries.rb GET_WALLET_ATTESTATIONS_FOR_SCHEMA_QUERY.
export const VERIFIED_BUILDER_QUERY = `query($recipient: String, $schema_id: String) {
  attestations(where: {
    recipient: { equals: $recipient },
    schemaId: { equals: $schema_id }
  }) {
    id
    attester
    revocationTime
    timeCreated
  }
}`

interface Attestation {
  attester?: unknown
  revocationTime?: unknown
}

export function countDistinctAttesters(responses: unknown[]): number | null {
  const attesters = new Set<string>()
  for (const raw of responses) {
    if (typeof raw !== 'object' || raw === null) return null
    const attestations = (raw as { data?: { attestations?: unknown } }).data?.attestations
    if (!Array.isArray(attestations)) return null
    for (const a of attestations as Attestation[]) {
      const revoked = typeof a.revocationTime === 'number' && a.revocationTime !== 0
      if (!revoked && typeof a.attester === 'string') attesters.add(a.attester.toLowerCase())
    }
  }
  return attesters.size
}

export async function readVerifiedBuilder(address: string): Promise<CredentialInput> {
  const schemaUid = registry.credentials.talent_protocol_verified_builder.schema_uid
  let recipient: string
  try {
    recipient = getAddress(address) // easscan stores checksummed recipients
  } catch {
    return { status: 'unavailable', reason: 'invalid wallet address' }
  }

  try {
    const responses = await Promise.all(
      ENDPOINTS.map(async (endpoint) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: VERIFIED_BUILDER_QUERY,
            variables: { recipient, schema_id: schemaUid },
          }),
        })
        if (!response.ok) throw new Error(`easscan ${response.status}`)
        return response.json()
      }),
    )
    const count = countDistinctAttesters(responses)
    if (count === null) {
      return { status: 'unavailable', reason: 'easscan returned an unexpected shape' }
    }
    return { status: 'ok', accounts: [count] }
  } catch {
    return { status: 'unavailable', reason: 'easscan (Base/Celo) unreachable' }
  }
}
