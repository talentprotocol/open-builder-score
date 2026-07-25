'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { isAddress } from 'viem'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type Scored } from '@/lib/orchestrate'
import type { Spec } from '@/lib/types'
import { inputPath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'
import { AttestPanel } from '@/components/attest-panel'

const spec = specJson as Spec

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; scored: Scored }

export default function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ wallet: string }>
  searchParams: Promise<{ github?: string }>
}) {
  const { wallet: rawWallet } = use(params)
  const { github } = use(searchParams)
  const wallet = decodeURIComponent(rawWallet)
  const githubHandle = github?.trim() || null

  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    if (!isAddress(wallet)) {
      setState({
        phase: 'error',
        message: 'That doesn’t look like an EVM address (0x…, 40 hex chars).',
      })
      return
    }
    const address = wallet // narrowed to `0x${string}` by isAddress above
    let cancelled = false
    setState({ phase: 'loading' })
    ;(async () => {
      try {
        const gather = await gatherInputs(address, githubHandle)
        if (cancelled) return
        setState({
          phase: 'done',
          scored: { score: computeScore(gather.inputs, spec), gather, address, githubHandle },
        })
      } catch {
        if (!cancelled) {
          setState({
            phase: 'error',
            message: 'Something went wrong while gathering data. Try again.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wallet, githubHandle])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      {state.phase === 'loading' && (
        <p className="text-sm text-zinc-400">
          Reading public data across 6 chains and GitHub…
        </p>
      )}

      {state.phase === 'error' && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
          <p className="text-sm text-red-400">{state.message}</p>
          <Link href="/score" className="text-sm text-emerald-400 underline">
            ← Back to the form
          </Link>
        </div>
      )}

      {state.phase === 'done' && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tabular-nums">{state.scored.score.total}</span>
              <span className="text-zinc-500">/ {state.scored.score.maxTotal}</span>
              {!state.scored.score.complete && (
                <span className="text-xs text-amber-500">
                  partial — some sources couldn&apos;t be checked
                </span>
              )}
            </div>
            <Link
              href={inputPath(state.scored.address, state.scored.githubHandle)}
              className="shrink-0 text-sm text-zinc-400 underline"
            >
              Edit inputs
            </Link>
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
        </section>
      )}
    </main>
  )
}
