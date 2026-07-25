'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs } from '@/lib/orchestrate'
import {
  decodeAttestationData,
  EASSCAN_SITE,
  fetchAttestation,
  isAttestationUid,
  scoreVerdict,
  validateAttestation,
  type DecodedScoreAttestation,
  type OnchainAttestation,
  type VerifyVerdict,
} from '@/lib/verify'
import type { ScoreResult, Spec } from '@/lib/types'
import { scorePath, verifyPath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'

const spec = specJson as Spec

type State =
  | { phase: 'loading'; step: string }
  | { phase: 'invalid'; problems: string[] }
  | {
      phase: 'done'
      verdict: VerifyVerdict
      attestation: OnchainAttestation
      decoded: DecodedScoreAttestation
      recomputed: ScoreResult
    }

export default function VerifyUidPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid: rawUid } = use(params)
  const uid = rawUid.trim()

  const [state, setState] = useState<State>({ phase: 'loading', step: 'Fetching attestation…' })

  useEffect(() => {
    if (!isAttestationUid(uid)) {
      setState({
        phase: 'invalid',
        problems: ['not a valid attestation UID (0x…, 64 hex chars)'],
      })
      return
    }
    let cancelled = false
    setState({ phase: 'loading', step: 'Fetching attestation…' })
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
      const problems = validateAttestation(fetched.attestation, decoded)
      if (problems.length > 0 || decoded === null) {
        setState({ phase: 'invalid', problems })
        return
      }
      setState({ phase: 'loading', step: 'Recomputing the score from public data…' })
      try {
        const gather = await gatherInputs(decoded.wallet, decoded.githubHandle)
        if (cancelled) return
        const recomputed = computeScore(gather.inputs, spec)
        setState({
          phase: 'done',
          verdict: scoreVerdict(decoded.score, recomputed),
          attestation: fetched.attestation,
          decoded,
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
  }, [uid])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'loading' && <p className="text-sm text-zinc-400">{state.step}</p>}

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

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          {state.verdict === 'match' && (
            <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4">
              <h1 className="text-sm font-medium text-emerald-400">
                ✓ Verified — recomputing today reproduces the attested score of{' '}
                {state.decoded.score}.
              </h1>
            </div>
          )}
          {state.verdict === 'diverged' && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
              <h1 className="text-sm font-medium text-amber-500">
                Attested {state.decoded.score}, recomputed {state.recomputed.total} today.
              </h1>
              <p className="text-xs text-zinc-400">
                Scores drift as public data changes. A divergence doesn’t mean the attestation was
                wrong when it was made — it means the data has moved since.
              </p>
            </div>
          )}
          {state.verdict === 'incomplete' && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
              <h1 className="text-sm font-medium text-amber-500">
                Comparison incomplete — some sources couldn’t be checked.
              </h1>
              <p className="text-xs text-zinc-400">
                Attested {state.decoded.score}; the partial recompute reached{' '}
                {state.recomputed.total}. Try again in a moment for a full comparison.
              </p>
            </div>
          )}

          <dl className="flex flex-col text-sm">
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Wallet</dt>
              <dd className="break-all text-right font-mono text-xs">
                <Link
                  href={scorePath(state.decoded.wallet, state.decoded.githubHandle)}
                  className="text-emerald-400 underline"
                >
                  {state.decoded.wallet}
                </Link>
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">GitHub handle</dt>
              <dd className="break-all text-right font-mono text-xs">
                {state.decoded.githubHandle ? `@${state.decoded.githubHandle}` : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Spec version</dt>
              <dd className="text-right font-mono text-xs">{state.decoded.specVersion}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Attested on</dt>
              <dd className="text-right font-mono text-xs">
                {new Date(state.attestation.timeCreated * 1000).toISOString()}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-800 py-1.5">
              <dt className="shrink-0 text-zinc-500">Attester</dt>
              <dd className="break-all text-right font-mono text-xs">
                {state.attestation.attester}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-zinc-500">Onchain record</dt>
              <dd className="text-right text-xs">
                <a
                  href={`${EASSCAN_SITE}/attestation/view/${state.attestation.uid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline"
                >
                  View on easscan
                </a>
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-400">Recomputed breakdown</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {state.recomputed.perCredential.map((result) => (
                <CredentialCard key={result.slug} result={result} />
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
