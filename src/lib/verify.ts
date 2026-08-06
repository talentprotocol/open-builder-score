import { decodeAbiParameters, getAddress, parseAbiParameters } from 'viem'
import specJson from '../../spec/spec.json'
import {
  ATTEST_AGGREGATE_LEGACY_SCHEMA,
  ATTEST_AGGREGATE_LEGACY_SCHEMA_UID,
  ATTEST_AGGREGATE_SCHEMA,
  ATTEST_AGGREGATE_SCHEMA_UID,
  ATTEST_AGGREGATE_SCORE_URL_SCHEMA,
  ATTEST_AGGREGATE_SCORE_URL_SCHEMA_UID,
  ATTEST_AGGREGATE_VERIFY_URL_SCHEMA,
  ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID,
  ATTEST_SCHEMA,
  ATTEST_SCHEMA_UID,
  EASSCAN_SITE,
  KNOWN_SCHEMA_UIDS,
} from './eas'
import {
  MAX_EXTRA_WALLETS,
  verifyLegacyOwnershipProofs,
  verifyOwnershipProofs,
  type OwnershipIO,
  type ProofCheck,
} from './ownership'
import type { ScoreResult, Spec } from './types'

const spec = specJson as Spec

export const EASSCAN_GRAPHQL = `${EASSCAN_SITE}/graphql`

// Derived from the canonical schema strings so the decoder can never drift from eas.ts.
const SCHEMA_PARAMS = parseAbiParameters(ATTEST_SCHEMA)
const AGGREGATE_SCHEMA_PARAMS = parseAbiParameters(ATTEST_AGGREGATE_SCHEMA)
const AGGREGATE_VERIFY_URL_SCHEMA_PARAMS = parseAbiParameters(ATTEST_AGGREGATE_VERIFY_URL_SCHEMA)
const AGGREGATE_LEGACY_SCHEMA_PARAMS = parseAbiParameters(ATTEST_AGGREGATE_LEGACY_SCHEMA)
const AGGREGATE_SCORE_URL_SCHEMA_PARAMS = parseAbiParameters(ATTEST_AGGREGATE_SCORE_URL_SCHEMA)

export const ATTESTATION_QUERY = `query($id: String!) {
  attestation(where: { id: $id }) {
    id
    schemaId
    recipient
    attester
    revocationTime
    timeCreated
    data
  }
}`

export interface OnchainAttestation {
  uid: string
  schemaId: string
  recipient: string
  attester: string
  revocationTime: number
  timeCreated: number
  data: `0x${string}`
}

export interface DecodedScoreAttestation {
  /** 1 = single wallet, 2 = aggregate. */
  version: 1 | 2
  specVersion: string
  /** The recipient — the wallet the score is issued to. Proven by msg.sender when it sends the transaction itself, or by its own proof in a v3 aggregate; see recipientProof. */
  wallet: `0x${string}`
  /** Empty for a single-wallet attestation. Index i pairs with ownershipProofs[i]. */
  extraWallets: `0x${string}`[]
  ownershipProofs: `0x${string}`[]
  /** v3 aggregates: the recipient's proof slot ('0x' when the recipient sent the tx). Null on older schemas. */
  recipientProof: `0x${string}` | null
  /** v3 aggregates: the shared EIP-712 anchor the proofs bind. Null on older schemas — those bound computedAt. */
  proofsIssuedAt: number | null
  githubHandle: string | null
  score: number
  computedAt: number
  blockNumber: bigint
  /** Aggregate only. Where the record says to go to see it verified. */
  verifyUrl: string | null
  /** Aggregate only. Slugs earned at scan time; zero-point, so they never move the score. */
  badges: string[]
}

export type FetchAttestationResult =
  | { status: 'found'; attestation: OnchainAttestation }
  | { status: 'not_found' }
  | { status: 'error'; reason: string }

export type VerifyVerdict = 'match' | 'diverged' | 'incomplete'

export function isAttestationUid(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function parseAttestationResponse(raw: unknown): FetchAttestationResult {
  const unexpected = { status: 'error', reason: 'easscan returned an unexpected shape' } as const
  if (typeof raw !== 'object' || raw === null) return unexpected
  const errors = (raw as { errors?: unknown }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    const message = (errors[0] as { message?: unknown })?.message
    const reason =
      typeof message === 'string' ? `easscan: ${message}` : 'easscan returned an error'
    return { status: 'error', reason }
  }
  const att = (raw as { data?: { attestation?: unknown } }).data?.attestation
  if (att === null) return { status: 'not_found' }
  if (typeof att !== 'object' || att === undefined) return unexpected
  const a = att as Record<string, unknown>
  if (
    typeof a.id !== 'string' ||
    typeof a.schemaId !== 'string' ||
    typeof a.recipient !== 'string' ||
    typeof a.attester !== 'string' ||
    typeof a.data !== 'string'
  ) {
    return unexpected
  }
  const revocationTime = Number(a.revocationTime ?? 0)
  const timeCreated = Number(a.timeCreated ?? 0)
  if (!Number.isFinite(revocationTime) || !Number.isFinite(timeCreated)) return unexpected
  return {
    status: 'found',
    attestation: {
      uid: a.id,
      schemaId: a.schemaId,
      recipient: a.recipient,
      attester: a.attester,
      revocationTime,
      timeCreated,
      data: a.data as `0x${string}`,
    },
  }
}

export async function fetchAttestation(
  uid: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchAttestationResult> {
  try {
    const response = await fetchFn(EASSCAN_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ATTESTATION_QUERY, variables: { id: uid } }),
    })
    if (!response.ok) return { status: 'error', reason: `easscan ${response.status}` }
    return parseAttestationResponse(await response.json())
  } catch {
    return { status: 'error', reason: 'easscan unreachable' }
  }
}

// schemaId is required and authoritative: it arrives from the chain alongside
// the data, and ABI decoding is permissive enough that reading one schema's
// bytes under another's parameters can yield plausible garbage instead of
// throwing. Trial-decoding would turn that into a silent wrong answer.
export function decodeAttestationData(
  data: `0x${string}`,
  schemaId: string,
): DecodedScoreAttestation | null {
  const uid = schemaId.toLowerCase()
  try {
    if (uid === ATTEST_SCHEMA_UID.toLowerCase()) {
      const [specVersion, wallet, githubHandle, score, computedAt, blockNumber] =
        decodeAbiParameters(SCHEMA_PARAMS, data)
      return {
        version: 1,
        specVersion,
        wallet,
        extraWallets: [],
        ownershipProofs: [],
        recipientProof: null,
        proofsIssuedAt: null,
        githubHandle: githubHandle === '' ? null : githubHandle,
        score,
        computedAt: Number(computedAt),
        blockNumber,
        verifyUrl: null,
        badges: [],
      }
    }
    // v3 — any wallet of the set may send the attestation. The sender's own
    // proof slot is '0x' (msg.sender is its proof); every proof binds
    // proofs_issued_at rather than computed_at.
    if (uid === ATTEST_AGGREGATE_SCHEMA_UID.toLowerCase()) {
      const [
        specVersion,
        wallet,
        extraWallets,
        ownershipProofs,
        recipientProof,
        proofsIssuedAt,
        githubHandle,
        score,
        computedAt,
        blockNumber,
        verifyUrl,
        badges,
      ] = decodeAbiParameters(AGGREGATE_SCHEMA_PARAMS, data)
      return {
        version: 2,
        specVersion,
        wallet,
        extraWallets: [...extraWallets],
        ownershipProofs: [...ownershipProofs],
        recipientProof,
        proofsIssuedAt: Number(proofsIssuedAt),
        githubHandle: githubHandle === '' ? null : githubHandle,
        score,
        computedAt: Number(computedAt),
        blockNumber,
        verifyUrl: verifyUrl === '' ? null : verifyUrl,
        badges: [...badges],
      }
    }
    if (uid === ATTEST_AGGREGATE_VERIFY_URL_SCHEMA_UID.toLowerCase()) {
      const [
        specVersion,
        wallet,
        extraWallets,
        ownershipProofs,
        githubHandle,
        score,
        computedAt,
        blockNumber,
        verifyUrl,
        badges,
      ] = decodeAbiParameters(AGGREGATE_VERIFY_URL_SCHEMA_PARAMS, data)
      return {
        version: 2,
        specVersion,
        wallet,
        extraWallets: [...extraWallets],
        ownershipProofs: [...ownershipProofs],
        recipientProof: null,
        proofsIssuedAt: null,
        githubHandle: githubHandle === '' ? null : githubHandle,
        score,
        computedAt: Number(computedAt),
        blockNumber,
        verifyUrl: verifyUrl === '' ? null : verifyUrl,
        badges: [...badges],
      }
    }
    // #2306 — identical but its URL pointed at a fresh scoring run. Surfaced as
    // null so the verify screen never offers a link that recomputes instead of
    // showing what was verified.
    if (uid === ATTEST_AGGREGATE_SCORE_URL_SCHEMA_UID.toLowerCase()) {
      const [specVersion, wallet, extraWallets, ownershipProofs, githubHandle, score, computedAt, blockNumber, , badges] =
        decodeAbiParameters(AGGREGATE_SCORE_URL_SCHEMA_PARAMS, data)
      return {
        version: 2,
        specVersion,
        wallet,
        extraWallets: [...extraWallets],
        ownershipProofs: [...ownershipProofs],
        recipientProof: null,
        proofsIssuedAt: null,
        githubHandle: githubHandle === '' ? null : githubHandle,
        score,
        computedAt: Number(computedAt),
        blockNumber,
        verifyUrl: null,
        badges: [...badges],
      }
    }
    if (uid === ATTEST_AGGREGATE_LEGACY_SCHEMA_UID.toLowerCase()) {
      const [specVersion, wallet, extraWallets, ownershipProofs, githubHandle, score, computedAt, blockNumber] =
        decodeAbiParameters(AGGREGATE_LEGACY_SCHEMA_PARAMS, data)
      return {
        version: 2,
        specVersion,
        wallet,
        extraWallets: [...extraWallets],
        ownershipProofs: [...ownershipProofs],
        recipientProof: null,
        proofsIssuedAt: null,
        githubHandle: githubHandle === '' ? null : githubHandle,
        score,
        computedAt: Number(computedAt),
        blockNumber,
        // This schema carried only a URL prefix, and no badge list at all.
        verifyUrl: null,
        badges: [],
      }
    }
    return null
  } catch {
    return null
  }
}

// Static integrity checks that don't require recomputation. Empty array = valid.
export function validateAttestation(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation | null,
): string[] {
  const problems: string[] = []
  const uid = att.schemaId.toLowerCase()
  if (!KNOWN_SCHEMA_UIDS.some((k) => k.toLowerCase() === uid)) {
    problems.push('attestation uses a different schema — not a Builder Score attestation')
  }
  if (decoded === null) {
    problems.push('attestation data does not decode as a Builder Score')
    return problems
  }
  try {
    if (getAddress(att.recipient) !== getAddress(decoded.wallet)) {
      problems.push('recipient does not match the attested wallet')
    }
  } catch {
    problems.push('recipient is not a valid address')
  }
  problems.push(...aggregateStructureProblems(decoded))
  return problems
}

// Encoding integrity only — whether the wallet set and proof list are coherent.
// Whether a proof actually verifies is a separate, independently displayed fact
// and deliberately never reaches classifyAttestation or scoreVerdict.
function aggregateStructureProblems(decoded: DecodedScoreAttestation): string[] {
  if (decoded.version !== 2) return []
  const problems: string[] = []
  const { extraWallets, ownershipProofs } = decoded

  if (extraWallets.length === 0) {
    problems.push('aggregate attestation carries no extra wallets')
  }
  if (extraWallets.length !== ownershipProofs.length) {
    problems.push('every extra wallet needs exactly one ownership proof')
  }
  // Also caps how far the verify page fans out, so a hostile attestation can't
  // turn the verifier's browser into an RPC storm.
  if (extraWallets.length > MAX_EXTRA_WALLETS) {
    problems.push(`aggregate attestation carries at most ${MAX_EXTRA_WALLETS} extra wallets`)
  }

  const ascending = extraWallets.every(
    (w, i) => i === 0 || extraWallets[i - 1].toLowerCase() < w.toLowerCase(),
  )
  if (!ascending) {
    problems.push('extra wallets are not in strictly ascending order')
  }

  try {
    const recipient = getAddress(decoded.wallet)
    if (extraWallets.some((w) => getAddress(w) === recipient)) {
      problems.push('an extra wallet repeats the recipient wallet')
    }
  } catch {
    problems.push('an extra wallet is not a valid address')
  }

  return problems
}

// EAS records the attester as msg.sender, so a self-attested record is proof
// the scored wallet signed for itself — permissionlessly checkable, which is
// exactly what a browser-only message signature would not be.
//
// Deliberately kept out of classifyAttestation and scoreVerdict: attestations
// made before the attest-time ownership gate legitimately have
// attester !== wallet, and retroactively calling those malformed would be
// wrong. Score correctness and wallet ownership are independent facts.
export function isSelfAttested(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation,
): boolean {
  try {
    return getAddress(att.attester) === getAddress(decoded.wallet)
  } catch {
    return false
  }
}

// v3 aggregates: the attester needs no stored proof, but only if it is one of
// the attested wallets. An outside attester is tolerated structurally — then
// every wallet must carry a proof, which the ownership display shows.
export function isAttesterInSet(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation,
): boolean {
  try {
    const attester = getAddress(att.attester)
    return [decoded.wallet, ...decoded.extraWallets].some((w) => getAddress(w) === attester)
  } catch {
    return false
  }
}

export type AttestationClassification =
  | { kind: 'malformed'; problems: string[] }
  | { kind: 'revoked'; decoded: DecodedScoreAttestation }
  | { kind: 'spec_mismatch'; decoded: DecodedScoreAttestation }
  | { kind: 'ok'; decoded: DecodedScoreAttestation }

// Precedence: integrity problems > revoked > spec mismatch > ok.
export function classifyAttestation(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation | null,
): AttestationClassification {
  const problems = validateAttestation(att, decoded)
  if (problems.length > 0 || decoded === null) return { kind: 'malformed', problems }
  if (att.revocationTime !== 0) return { kind: 'revoked', decoded }
  if (decoded.specVersion !== spec.version) return { kind: 'spec_mismatch', decoded }
  return { kind: 'ok', decoded }
}

export function scoreVerdict(attestedScore: number, recomputed: ScoreResult): VerifyVerdict {
  if (!recomputed.complete) return 'incomplete'
  return recomputed.total === attestedScore ? 'match' : 'diverged'
}

// Ownership is signature recovery over the decoded wallet set — it does not
// depend on the spec version being comparable, so every verify path that has
// a decoded aggregate must run it, the not-comparable one included. Otherwise
// a fabricated aggregate need only carry an outdated spec string to dodge the
// ownership verdict entirely.
export async function verifyAttestationOwnership(
  att: OnchainAttestation,
  decoded: DecodedScoreAttestation,
  io: OwnershipIO = {},
): Promise<ProofCheck[]> {
  if (decoded.extraWallets.length === 0) return []
  if (decoded.proofsIssuedAt !== null) {
    return verifyOwnershipProofs(
      {
        recipient: decoded.wallet,
        extras: decoded.extraWallets,
        proofs: decoded.ownershipProofs,
        recipientProof: decoded.recipientProof ?? '0x',
        attester: att.attester as `0x${string}`,
        issuedAt: decoded.proofsIssuedAt,
        at: att.timeCreated,
      },
      io,
    )
  }
  return verifyLegacyOwnershipProofs(
    {
      primary: decoded.wallet,
      extras: decoded.extraWallets,
      proofs: decoded.ownershipProofs,
      computedAt: decoded.computedAt,
      at: att.timeCreated,
    },
    io,
  )
}
