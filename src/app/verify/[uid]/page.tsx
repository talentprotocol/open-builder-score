'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { scannedChainCount } from '@/lib/credential-reference'
import { gatherMultiInputs, type GatherSource } from '@/lib/orchestrate'
import { readGithubCredentials } from '@/lib/github'
import { authorizedFetch } from '@/lib/github-auth'
import { useGithubAuth } from '@/components/use-github-auth'
import {
  classifyAttestation,
  decodeAttestationData,
  fetchAttestation,
  isAttestationUid,
  isAttesterInSet,
  isSelfAttested,
  scoreVerdict,
  type DecodedScoreAttestation,
  type OnchainAttestation,
  type VerifyVerdict,
} from '@/lib/verify'
import { EASSCAN_SITE } from '@/lib/eas'
import { verifyLegacyOwnershipProofs, verifyOwnershipProofs, type ProofCheck } from '@/lib/ownership'
import { classifyAttestedBadges, type BadgeEvidence } from '@/lib/badges'
import type { ScoreResult, Spec } from '@/lib/types'
import { scorePath, verifyPath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'
import { motion } from 'motion/react'
import { FadeRise } from '@/components/motion/fade-rise'
import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'
import { SPRING } from '@/components/motion/presets'

const spec = specJson as Spec

type State =
  | { phase: 'loading'; step: string; settled: GatherSource[]; walletCount?: number }
  | { phase: 'invalid'; problems: string[] }
  | {
      phase: 'not_comparable'
      reason: 'revoked' | 'spec_mismatch'
      attestation: OnchainAttestation
      decoded: DecodedScoreAttestation
    }
  | {
      phase: 'done'
      verdict: VerifyVerdict
      attestation: OnchainAttestation
      decoded: DecodedScoreAttestation
      recomputed: ScoreResult
      /** Empty for a single-wallet attestation. Never feeds the score verdict. */
      ownership: ProofCheck[]
    }

// Badges are recorded, never recomputed here. The attestation stores the slug
// but not which check earned it, so the copy states what the badge *can* rest
// on rather than asserting this instance was proven.
const BADGE_EVIDENCE: Record<BadgeEvidence, { tone: string; text: string }> = {
  public: {
    tone: 'text-success-text',
    text: 're-derivable from public chain history',
  },
  mixed: {
    tone: 'text-muted-foreground',
    text: 'earned by a live onchain read or by a dated Talent Protocol export — the record does not say which',
  },
  export: {
    tone: 'text-muted-foreground',
    text: 'rests on a dated Talent Protocol export — recorded, not independently checkable',
  },
}

const OWNERSHIP_COPY: Record<ProofCheck['status'], { tone: string; text: string }> = {
  // No qualifier: recovering an address from an ECDSA signature is arithmetic
  // over bytes already onchain — no server, no RPC, true forever.
  eoa: { tone: 'text-success-text', text: '✓ signature recovers to this wallet' },
  // ERC-1271 asks a contract whose owner set can change, so this is a statement
  // about current state, not about the moment of attestation. Say so.
  contract: {
    tone: 'text-success-text',
    text: '✓ accepted by the account contract (ERC-1271 — depends on its current owners)',
  },
  invalid: { tone: 'text-warning-text', text: '⚠ signature does not prove this wallet' },
  expired: { tone: 'text-warning-text', text: '⚠ signed outside the proofs’ validity window' },
  missing: { tone: 'text-warning-text', text: '⚠ no ownership signature' },
  unchecked: { tone: 'text-muted-foreground', text: '· couldn’t check right now' },
  // msg.sender: EAS itself recorded this wallet as the attester. Free, onchain,
  // and as permanent as the attestation.
  attester: { tone: 'text-success-text', text: '✓ proved by sending this attestation' },
}

function AttestationDetails({
  attestation,
  decoded,
  ownership = [],
}: {
  attestation: OnchainAttestation
  decoded: DecodedScoreAttestation
  ownership?: ProofCheck[]
}) {
  return (
    <dl className="flex flex-col text-base">
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">
          {decoded.extraWallets.length > 0 ? 'Wallets' : 'Wallet'}
        </dt>
        <dd className="break-all text-right font-mono text-sm">
          <Link
            href={scorePath(decoded.wallet, decoded.githubHandle, decoded.extraWallets)}
            className="text-success-text underline"
          >
            {decoded.wallet}
          </Link>
          {decoded.extraWallets.map((w) => (
            <span key={w} className="block">
              + {w}
            </span>
          ))}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">GitHub handle</dt>
        <dd className="break-all text-right font-mono text-sm">
          {decoded.githubHandle ? `@${decoded.githubHandle}` : '—'}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">Spec version</dt>
        <dd className="text-right font-mono text-sm">{decoded.specVersion}</dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">Attested on</dt>
        <dd className="text-right font-mono text-sm">
          {new Date(attestation.timeCreated * 1000).toISOString()}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">Computed at</dt>
        <dd className="text-right font-mono text-sm">
          {new Date(decoded.computedAt * 1000).toISOString()}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">As-of Base block</dt>
        <dd className="text-right font-mono text-sm">{decoded.blockNumber.toString()}</dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">Attester</dt>
        <dd className="break-all text-right font-mono text-sm">
          {attestation.attester}
          {decoded.extraWallets.length > 0 ? (
            isAttesterInSet(attestation, decoded) ? (
              <span className="block font-sans text-xs text-success-text">
                ✓ In the wallet set — proved by sending this attestation
              </span>
            ) : (
              <span className="block font-sans text-xs text-warning-text">
                ⚠ Outside the wallet set — every wallet must carry its own signature
              </span>
            )
          ) : isSelfAttested(attestation, decoded) ? (
            <span className="block font-sans text-xs text-success-text">
              ✓ Self-attested — the scored wallet signed this itself
            </span>
          ) : (
            <span className="block font-sans text-xs text-warning-text">
              ⚠ Not the scored wallet — someone else attested this score
            </span>
          )}
        </dd>
      </div>
      {decoded.extraWallets.length > 0 && (
        <div className="flex justify-between gap-4 border-b border-border py-1.5">
          <dt className="shrink-0 text-muted-foreground">Wallet ownership</dt>
          <dd className="break-all text-right text-sm">
            {ownership.length === 0 ? (
              <span className="text-muted-foreground">· not checked</span>
            ) : (
              ownership.map((check) => (
                <span key={check.wallet} className="block">
                  <span className="font-mono">{check.wallet}</span>
                  <span className={`block text-xs ${OWNERSHIP_COPY[check.status].tone}`}>
                    {OWNERSHIP_COPY[check.status].text}
                  </span>
                </span>
              ))
            )}
          </dd>
        </div>
      )}
      {decoded.badges.length > 0 && (
        <div className="flex justify-between gap-4 border-b border-border py-1.5">
          <dt className="shrink-0 text-muted-foreground">Badges</dt>
          <dd className="text-right text-sm">
            {classifyAttestedBadges(decoded.badges).map((b) => (
              <span key={b.slug} className="block">
                {b.name}
                <span className={`block text-xs ${BADGE_EVIDENCE[b.evidence].tone}`}>
                  {BADGE_EVIDENCE[b.evidence].text}
                </span>
              </span>
            ))}
          </dd>
        </div>
      )}
      {decoded.verifyUrl && (
        <div className="flex justify-between gap-4 border-b border-border py-1.5">
          <dt className="shrink-0 text-muted-foreground">Verify URL</dt>
          <dd className="break-all text-right text-sm">
            <a href={decoded.verifyUrl} className="text-success-text underline">
              {decoded.verifyUrl}
            </a>
          </dd>
        </div>
      )}
      <div className="flex justify-between gap-4 border-b border-border py-1.5">
        <dt className="shrink-0 text-muted-foreground">Schema</dt>
        <dd className="text-right text-sm">
          <a
            href={`${EASSCAN_SITE}/schema/view/${attestation.schemaId}`}
            target="_blank"
            rel="noreferrer"
            className="text-success-text underline"
          >
            {decoded.version === 2 ? 'aggregate' : 'single-wallet'}
          </a>
        </dd>
      </div>
      <div className="flex justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-muted-foreground">Onchain record</dt>
        <dd className="text-right text-sm">
          <a
            href={`${EASSCAN_SITE}/attestation/view/${attestation.uid}`}
            target="_blank"
            rel="noreferrer"
            className="text-success-text underline"
          >
            View on easscan
          </a>
        </dd>
      </div>
    </dl>
  )
}

export default function VerifyUidPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid: rawUid } = use(params)
  const uid = rawUid.trim()
  const auth = useGithubAuth()

  const [state, setState] = useState<State>({
    phase: 'loading',
    step: 'Fetching attestation…',
    settled: [],
  })

  useEffect(() => {
    if (!isAttestationUid(uid)) {
      setState({
        phase: 'invalid',
        problems: ['not a valid attestation UID (0x…, 64 hex chars)'],
      })
      return
    }
    let cancelled = false
    setState({ phase: 'loading', step: 'Fetching attestation…', settled: [] })
    ;(async () => {
      const fetched = await fetchAttestation(uid)
      if (cancelled) return
      if (fetched.status === 'not_found') {
        setState({ phase: 'invalid', problems: ['no attestation found with this UID'] })
        return
      }
      if (fetched.status === 'error') {
        setState({ phase: 'invalid', problems: [fetched.reason] })
        return
      }
      const decoded = decodeAttestationData(
        fetched.attestation.data,
        fetched.attestation.schemaId,
      )
      const classification = classifyAttestation(fetched.attestation, decoded)
      if (classification.kind === 'malformed') {
        setState({ phase: 'invalid', problems: classification.problems })
        return
      }
      if (classification.kind === 'revoked' || classification.kind === 'spec_mismatch') {
        setState({
          phase: 'not_comparable',
          reason: classification.kind,
          attestation: fetched.attestation,
          decoded: classification.decoded,
        })
        return
      }
      setState({
        phase: 'loading',
        step: 'Recomputing the score from public data…',
        settled: [],
        // A 5-wallet recompute fans out 5x, so say how much work is in flight
        // rather than letting a slow scan read as hung.
        walletCount: 1 + classification.decoded.extraWallets.length,
      })
      try {
        const fetchers = auth
          ? { github: (handle: string | null) => readGithubCredentials(handle, authorizedFetch(auth.token)) }
          : {}
        const gather = await gatherMultiInputs(
          [classification.decoded.wallet, ...classification.decoded.extraWallets],
          classification.decoded.githubHandle,
          fetchers,
          (source) => {
            if (cancelled) return
            setState((prev) =>
              prev.phase === 'loading'
                ? { ...prev, settled: [...prev.settled, source] }
                : prev,
            )
          },
        )
        if (cancelled) return
        const recomputed = computeScore(gather.inputs, spec)
        // Ownership is checked alongside the recompute and deliberately never
        // folded into the verdict: score correctness and wallet ownership are
        // independent facts, and are displayed as two.
        const ownership =
          classification.decoded.extraWallets.length > 0
            ? classification.decoded.proofsIssuedAt !== null
              ? await verifyOwnershipProofs({
                  recipient: classification.decoded.wallet,
                  extras: classification.decoded.extraWallets,
                  proofs: classification.decoded.ownershipProofs,
                  recipientProof: classification.decoded.recipientProof ?? '0x',
                  attester: fetched.attestation.attester as `0x${string}`,
                  issuedAt: classification.decoded.proofsIssuedAt,
                  at: fetched.attestation.timeCreated,
                })
              : await verifyLegacyOwnershipProofs({
                  primary: classification.decoded.wallet,
                  extras: classification.decoded.extraWallets,
                  proofs: classification.decoded.ownershipProofs,
                  computedAt: classification.decoded.computedAt,
                  at: fetched.attestation.timeCreated,
                })
            : []
        if (cancelled) return
        setState({
          phase: 'done',
          verdict: scoreVerdict(classification.decoded.score, recomputed),
          attestation: fetched.attestation,
          decoded: classification.decoded,
          recomputed,
          ownership,
        })
      } catch {
        if (!cancelled) {
          setState({
            phase: 'invalid',
            problems: ['something went wrong while recomputing — try again'],
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid, auth])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'loading' && (
        <div className="blueprint-grid relative overflow-hidden rounded-lg border bg-card/50 p-6">
          <SweepOverlay />
          <p className="flex items-center gap-2.5 text-base text-muted-foreground">
            <PingDot settled={false} /> {state.step}
          </p>
          {state.step.startsWith('Recomputing') && (
            <ul className="mt-4 flex flex-col gap-2.5 text-base">
              {(
                [
                  [
                    'chains',
                    state.walletCount && state.walletCount > 1
                      ? `Onchain badges & balances (${scannedChainCount(spec)} chains, ${state.walletCount} wallets)`
                      : `Onchain badges & balances (${scannedChainCount(spec)} chains)`,
                  ],
                  ['github', 'GitHub'],
                  ['speedrun', 'SpeedRun Ethereum'],
                  ['verifiedBuilder', 'EAS attestations'],
                ] as [GatherSource, string][]
              ).map(([source, label]) => {
                const done = state.settled.includes(source)
                return (
                  <li
                    key={source}
                    className={`flex items-center gap-2.5 ${done ? 'text-success-text' : 'text-muted-foreground'}`}
                  >
                    <PingDot settled={done} /> {label}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {state.phase === 'invalid' && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <h1 className="text-base font-medium text-destructive-text">
            Attestation could not be verified
          </h1>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-base text-foreground">
            {state.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <Link href={verifyPath()} className="text-base text-muted-foreground underline hover:text-foreground">
            ← Verify another attestation
          </Link>
        </div>
      )}

      {state.phase === 'not_comparable' && (
        <section className="flex flex-col gap-6">
          <FadeRise>
            <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 p-4">
              {state.reason === 'revoked' ? (
                <>
                  <h1 className="text-base font-medium text-warning-text">
                    This attestation was revoked.
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    It was an authentic Builder Score attestation, but it has since been revoked
                    onchain — treat it as withdrawn.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-base font-medium text-warning-text">
                    Authentic attestation, different spec version.
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    It was computed with spec v{state.decoded.specVersion}; this app recomputes spec v
                    {spec.version}, so an exact comparison isn’t possible.
                  </p>
                </>
              )}
            </div>
          </FadeRise>

          <FadeRise delay={0.1}>
            <AttestationDetails attestation={state.attestation} decoded={state.decoded} />
          </FadeRise>

          <Link href={verifyPath()} className="text-base text-muted-foreground underline hover:text-foreground">
            ← Verify another attestation
          </Link>
        </section>
      )}

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          {state.verdict === 'match' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING}
              className="rounded-lg border border-success/30 bg-success/10 p-4"
            >
              <h1 className="text-base font-medium text-success-text">
                ✓ Verified — recomputing today reproduces the attested score of{' '}
                {state.decoded.score}.
              </h1>
            </motion.div>
          )}
          {state.verdict === 'diverged' && (
            <FadeRise>
              <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <h1 className="text-base font-medium text-warning-text">
                  Attested {state.decoded.score}, recomputed {state.recomputed.total} today.
                </h1>
                <p className="text-sm text-muted-foreground">
                  Scores drift as public data changes. A divergence doesn’t mean the attestation was
                  wrong when it was made — it means the data has moved since.
                </p>
              </div>
            </FadeRise>
          )}
          {state.verdict === 'incomplete' && (
            <FadeRise>
              <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 p-4">
                <h1 className="text-base font-medium text-warning-text">
                  Comparison incomplete — some sources couldn’t be checked.
                </h1>
                <p className="text-sm text-muted-foreground">
                  Attested {state.decoded.score}; the partial recompute reached{' '}
                  {state.recomputed.total}. Try again in a moment for a full comparison.
                </p>
              </div>
            </FadeRise>
          )}

          <FadeRise delay={0.1}>
            <AttestationDetails attestation={state.attestation} decoded={state.decoded} ownership={state.ownership} />
          </FadeRise>

          <FadeRise delay={0.15}>
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-medium text-muted-foreground">Recomputed breakdown</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {state.recomputed.perCredential.map((result) => (
                  <CredentialCard key={result.slug} result={result} />
                ))}
              </div>
            </div>
          </FadeRise>
        </section>
      )}
    </main>
  )
}
