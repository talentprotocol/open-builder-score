'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type GatherSource } from '@/lib/orchestrate'
import { readGithubCredentials } from '@/lib/github'
import { authorizedFetch } from '@/lib/github-auth'
import { useGithubAuth } from '@/components/use-github-auth'
import {
  classifyAttestation,
  decodeAttestationData,
  fetchAttestation,
  isAttestationUid,
  scoreVerdict,
  type DecodedScoreAttestation,
  type OnchainAttestation,
  type VerifyVerdict,
} from '@/lib/verify'
import { EASSCAN_SITE } from '@/lib/eas'
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
  | { phase: 'loading'; step: string; settled: GatherSource[] }
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
    }

function AttestationDetails({
  attestation,
  decoded,
}: {
  attestation: OnchainAttestation
  decoded: DecodedScoreAttestation
}) {
  return (
    <dl className="flex flex-col text-sm">
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">Wallet</dt>
        <dd className="break-all text-right font-mono text-xs">
          <Link
            href={scorePath(decoded.wallet, decoded.githubHandle)}
            className="text-emerald-400 underline"
          >
            {decoded.wallet}
          </Link>
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">GitHub handle</dt>
        <dd className="break-all text-right font-mono text-xs">
          {decoded.githubHandle ? `@${decoded.githubHandle}` : '—'}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">Spec version</dt>
        <dd className="text-right font-mono text-xs">{decoded.specVersion}</dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">Attested on</dt>
        <dd className="text-right font-mono text-xs">
          {new Date(attestation.timeCreated * 1000).toISOString()}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">Computed at</dt>
        <dd className="text-right font-mono text-xs">
          {new Date(decoded.computedAt * 1000).toISOString()}
        </dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">As-of Base block</dt>
        <dd className="text-right font-mono text-xs">{decoded.blockNumber.toString()}</dd>
      </div>
      <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
        <dt className="shrink-0 text-zinc-500">Attester</dt>
        <dd className="break-all text-right font-mono text-xs">{attestation.attester}</dd>
      </div>
      <div className="flex justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-zinc-500">Onchain record</dt>
        <dd className="text-right text-xs">
          <a
            href={`${EASSCAN_SITE}/attestation/view/${attestation.uid}`}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 underline"
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
      const decoded = decodeAttestationData(fetched.attestation.data)
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
      })
      try {
        const fetchers = auth
          ? { github: (handle: string | null) => readGithubCredentials(handle, authorizedFetch(auth.token)) }
          : {}
        const gather = await gatherInputs(
          classification.decoded.wallet,
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
        setState({
          phase: 'done',
          verdict: scoreVerdict(classification.decoded.score, recomputed),
          attestation: fetched.attestation,
          decoded: classification.decoded,
          recomputed,
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
        <div className="blueprint-grid relative overflow-hidden rounded-lg border border-zinc-800 p-6">
          <SweepOverlay />
          <p className="flex items-center gap-2.5 text-sm text-zinc-400">
            <PingDot settled={false} /> {state.step}
          </p>
          {state.step.startsWith('Recomputing') && (
            <ul className="mt-4 flex flex-col gap-2.5 text-sm">
              {(
                [
                  ['chains', 'Onchain badges & balances (6 chains)'],
                  ['github', 'GitHub'],
                  ['speedrun', 'SpeedRun Ethereum'],
                  ['verifiedBuilder', 'EAS attestations'],
                ] as [GatherSource, string][]
              ).map(([source, label]) => {
                const done = state.settled.includes(source)
                return (
                  <li
                    key={source}
                    className={`flex items-center gap-2.5 ${done ? 'text-emerald-400' : 'text-zinc-500'}`}
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
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
          <h1 className="text-sm font-medium text-red-400">Attestation could not be verified</h1>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-300">
            {state.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <Link href={verifyPath()} className="text-sm text-emerald-400 underline">
            ← Verify another attestation
          </Link>
        </div>
      )}

      {state.phase === 'not_comparable' && (
        <section className="flex flex-col gap-6">
          <FadeRise>
            <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
              {state.reason === 'revoked' ? (
                <>
                  <h1 className="text-sm font-medium text-amber-500">
                    This attestation was revoked.
                  </h1>
                  <p className="text-xs text-zinc-400">
                    It was an authentic Builder Score attestation, but it has since been revoked
                    onchain — treat it as withdrawn.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-sm font-medium text-amber-500">
                    Authentic attestation, different spec version.
                  </h1>
                  <p className="text-xs text-zinc-400">
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

          <Link href={verifyPath()} className="text-sm text-emerald-400 underline">
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
              className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4"
            >
              <h1 className="text-sm font-medium text-emerald-400">
                ✓ Verified — recomputing today reproduces the attested score of{' '}
                {state.decoded.score}.
              </h1>
            </motion.div>
          )}
          {state.verdict === 'diverged' && (
            <FadeRise>
              <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
                <h1 className="text-sm font-medium text-amber-500">
                  Attested {state.decoded.score}, recomputed {state.recomputed.total} today.
                </h1>
                <p className="text-xs text-zinc-400">
                  Scores drift as public data changes. A divergence doesn’t mean the attestation was
                  wrong when it was made — it means the data has moved since.
                </p>
              </div>
            </FadeRise>
          )}
          {state.verdict === 'incomplete' && (
            <FadeRise>
              <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
                <h1 className="text-sm font-medium text-amber-500">
                  Comparison incomplete — some sources couldn’t be checked.
                </h1>
                <p className="text-xs text-zinc-400">
                  Attested {state.decoded.score}; the partial recompute reached{' '}
                  {state.recomputed.total}. Try again in a moment for a full comparison.
                </p>
              </div>
            </FadeRise>
          )}

          <FadeRise delay={0.1}>
            <AttestationDetails attestation={state.attestation} decoded={state.decoded} />
          </FadeRise>

          <FadeRise delay={0.15}>
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-zinc-400">Recomputed breakdown</h2>
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
