'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAddress } from 'viem'
import specJson from '../../../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherMultiInputs, type GatherSource, type Scored } from '@/lib/orchestrate'
import { looksLikeEnsName, resolveEnsName } from '@/lib/ens'
import { readGithubCredentials } from '@/lib/github'
import { authorizedFetch } from '@/lib/github-auth'
import { useGithubAuth } from '@/components/use-github-auth'
import type { Spec } from '@/lib/types'
import { inputPath, scorePath } from '@/lib/routes'
import { CredentialCard } from '@/components/credential-card'
import { AttestPanel } from '@/components/attest-panel'
import { AttestationHistory } from '@/components/attestation-history'
import { CopyLinkButton } from '@/components/copy-link-button'
import { ScorePercentile } from '@/components/score-percentile'

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
  searchParams: Promise<{ github?: string; wallets?: string }>
}) {
  const router = useRouter()
  const auth = useGithubAuth()
  const { wallet: rawWallet } = use(params)
  const { github, wallets } = use(searchParams)
  let wallet: string
  try {
    wallet = decodeURIComponent(rawWallet)
  } catch {
    // Malformed percent-encoding: fall through with the raw segment, which
    // fails isAddress and surfaces the normal error state.
    wallet = rawWallet
  }
  const githubHandle = github?.trim() || null
  const extrasRaw = (wallets ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .slice(0, 4)
  const tokens = [wallet, ...extrasRaw]
  const allAddresses = tokens.every((t) => isAddress(t))
  const allValid = tokens.every((t) => isAddress(t) || looksLikeEnsName(t))

  // Lazy init picks the right phase synchronously, avoiding a one-frame
  // checklist flash on ENS/invalid URLs before the effect runs.
  const [state, setState] = useState<State>(() =>
    allAddresses
      ? { phase: 'loading', settled: [] }
      : allValid
        ? { phase: 'resolving' }
        : {
            phase: 'error',
            message: 'That doesn’t look like an EVM address (0x…, 40 hex chars) or ENS name.',
          },
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    if (!allAddresses) {
      if (allValid) {
        // Shareable links may hold ENS names anywhere in the wallet list:
        // resolve them all, dedupe, then canonicalize the URL.
        setState({ phase: 'resolving' })
        ;(async () => {
          const resolved = await Promise.all(
            tokens.map(async (token) => ({
              token,
              result: isAddress(token)
                ? ({ status: 'resolved', address: token } as const)
                : await resolveEnsName(token),
            })),
          )
          if (cancelled) return
          const failed = resolved.find(({ result }) => result.status !== 'resolved')
          if (failed) {
            setState({
              phase: 'error',
              message:
                failed.result.status === 'unresolved'
                  ? `“${failed.token}” doesn’t resolve to an address.`
                  : (failed.result as { reason: string }).reason,
            })
            return
          }
          const [primary, ...rest] = resolved.map(
            ({ result }) => (result as { address: `0x${string}` }).address,
          )
          const seen = new Set([primary.toLowerCase()])
          const deduped = rest.filter((a) => {
            if (seen.has(a.toLowerCase())) return false
            seen.add(a.toLowerCase())
            return true
          })
          router.replace(scorePath(primary, githubHandle, deduped))
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

    const address = wallet as `0x${string}`
    const seen = new Set([address.toLowerCase()])
    const extraAddresses = (extrasRaw as `0x${string}`[]).filter((a) => {
      if (seen.has(a.toLowerCase())) return false
      seen.add(a.toLowerCase())
      return true
    })
    setState({ phase: 'loading', settled: [] })
    ;(async () => {
      try {
        // Signed-in sessions authenticate GitHub reads (5,000 req/hr vs 60).
        const fetchers = auth
          ? { github: (handle: string | null) => readGithubCredentials(handle, authorizedFetch(auth.token)) }
          : {}
        const gather = await gatherMultiInputs(
          [address, ...extraAddresses],
          githubHandle,
          fetchers,
          (source) => {
            if (cancelled) return
            setState((prev) =>
              prev.phase === 'loading'
                ? { phase: 'loading', settled: [...prev.settled, source] }
                : prev,
            )
          },
        )
        if (cancelled) return
        setState({
          phase: 'done',
          scored: {
            score: computeScore(gather.inputs, spec),
            gather,
            address,
            githubHandle,
            extraAddresses,
          },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, wallets, githubHandle, attempt, router, auth])

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
                {done ? '✓' : '○'}{' '}
                {source === 'chains' && extrasRaw.length > 0
                  ? `Onchain badges & balances (6 chains, ${extrasRaw.length + 1} wallets)`
                  : SOURCE_LABELS[source]}
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
                href={inputPath(state.scored.address, state.scored.githubHandle, state.scored.extraAddresses)}
                className="text-sm text-zinc-400 underline"
              >
                Edit inputs
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <p className="break-all font-mono text-xs text-zinc-500">
              {state.scored.address}
              {state.scored.githubHandle && ` · @${state.scored.githubHandle}`}
              {state.scored.githubHandle &&
                auth?.login.toLowerCase() === state.scored.githubHandle.toLowerCase() && (
                  <span className="text-emerald-400"> · verified</span>
                )}
            </p>
            {state.scored.extraAddresses.map((a) => (
              <p key={a} className="break-all font-mono text-xs text-zinc-500">
                + {a}
              </p>
            ))}
          </div>

          <ScorePercentile score={state.scored.score.total} />

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
