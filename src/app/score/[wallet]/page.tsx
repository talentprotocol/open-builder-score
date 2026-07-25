'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAddress } from 'viem'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type GatherSource, type Scored } from '@/lib/orchestrate'
import { looksLikeEnsName, resolveEnsName } from '@/lib/ens'
import type { Spec } from '@/lib/types'
import { inputPath, scorePath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'
import { AttestPanel } from '@/components/attest-panel'
import { AttestationHistory } from '@/components/attestation-history'
import { CopyLinkButton } from '@/components/copy-link-button'

const spec = specJson as Spec

const SOURCE_LABELS: Record<GatherSource, string> = {
  chains: 'Onchain badges & balances (6 chains)',
  github: 'GitHub',
  speedrun: 'SpeedRun Ethereum',
  verifiedBuilder: 'EAS attestations',
}

const SOURCES = Object.keys(SOURCE_LABELS) as GatherSource[]

type State =
  | { phase: 'resolving' }
  | { phase: 'loading'; settled: GatherSource[] }
  | { phase: 'error'; message: string }
  | { phase: 'done'; scored: Scored }

export default function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ wallet: string }>
  searchParams: Promise<{ github?: string }>
}) {
  const router = useRouter()
  const { wallet: rawWallet } = use(params)
  const { github } = use(searchParams)
  let wallet: string
  try {
    wallet = decodeURIComponent(rawWallet)
  } catch {
    // Malformed percent-encoding: fall through with the raw segment, which
    // fails isAddress and surfaces the normal error state.
    wallet = rawWallet
  }
  const githubHandle = github?.trim() || null

  const [state, setState] = useState<State>({ phase: 'loading', settled: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    if (!isAddress(wallet)) {
      if (looksLikeEnsName(wallet)) {
        // Shareable links like /score/vitalik.eth: resolve, then canonicalize.
        setState({ phase: 'resolving' })
        ;(async () => {
          const resolution = await resolveEnsName(wallet)
          if (cancelled) return
          if (resolution.status === 'resolved') {
            router.replace(scorePath(resolution.address, githubHandle))
          } else if (resolution.status === 'unresolved') {
            setState({ phase: 'error', message: `“${wallet}” doesn’t resolve to an address.` })
          } else {
            setState({ phase: 'error', message: resolution.reason })
          }
        })()
      } else {
        setState({
          phase: 'error',
          message: 'That doesn’t look like an EVM address (0x…, 40 hex chars) or ENS name.',
        })
      }
      return () => {
        cancelled = true
      }
    }

    const address = wallet // narrowed to `0x${string}` by isAddress above
    setState({ phase: 'loading', settled: [] })
    ;(async () => {
      try {
        const gather = await gatherInputs(address, githubHandle, {}, (source) => {
          if (cancelled) return
          setState((prev) =>
            prev.phase === 'loading'
              ? { phase: 'loading', settled: [...prev.settled, source] }
              : prev,
          )
        })
        if (cancelled) return
        setState({
          phase: 'done',
          scored: { score: computeScore(gather.inputs, spec), gather, address, githubHandle },
        })
      } catch {
        if (!cancelled) {
          setState({ phase: 'error', message: 'Something went wrong while gathering data.' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wallet, githubHandle, attempt, router])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'resolving' && (
        <p className="text-sm text-zinc-400">Resolving ENS name…</p>
      )}

      {state.phase === 'loading' && (
        <ul className="flex flex-col gap-2 text-sm">
          {SOURCES.map((source) => {
            const done = state.settled.includes(source)
            return (
              <li key={source} className={done ? 'text-emerald-400' : 'text-zinc-500'}>
                {done ? '✓' : '○'} {SOURCE_LABELS[source]}
              </li>
            )
          })}
        </ul>
      )}

      {state.phase === 'error' && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
          <p className="text-sm text-red-400">{state.message}</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setAttempt((a) => a + 1)}
              className="text-sm text-emerald-400 underline"
            >
              Try again
            </button>
            <Link href={inputPath()} className="text-sm text-zinc-400 underline">
              ← Back to the form
            </Link>
          </div>
        </div>
      )}

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tabular-nums">{state.scored.score.total}</span>
              <span className="text-zinc-500">/ {state.scored.score.maxTotal}</span>
              {!state.scored.score.complete && (
                <span className="flex items-center gap-2 text-xs text-amber-500">
                  partial — some sources couldn&apos;t be checked
                  <button onClick={() => setAttempt((a) => a + 1)} className="underline">
                    try again
                  </button>
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <CopyLinkButton />
              <Link
                href={inputPath(state.scored.address, state.scored.githubHandle)}
                className="text-sm text-zinc-400 underline"
              >
                Edit inputs
              </Link>
            </div>
          </div>

          <p className="break-all font-mono text-xs text-zinc-500">
            {state.scored.address}
            {state.scored.githubHandle && ` · @${state.scored.githubHandle}`}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {state.scored.score.perCredential.map((result) => (
              <CredentialCard key={result.slug} result={result} />
            ))}
          </div>

          <p className="text-xs text-zinc-600">
            github_repositories approximates production (public repo count vs. repos
            contributed-to). Computed at{' '}
            {new Date(state.scored.gather.inputs.computedAt * 1000).toISOString()}
            {state.scored.gather.baseBlockNumber !== null &&
              `, Base block ${state.scored.gather.baseBlockNumber}`}
            .
          </p>

          <AttestPanel scored={state.scored} />

          <AttestationHistory wallet={state.scored.address} />
        </section>
      )}
    </main>
  )
}
