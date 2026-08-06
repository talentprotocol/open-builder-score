'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchLatestAttestations, type LatestAttestation } from '@/lib/latest'
import { inputPath, verifyPath } from '@/lib/routes'
import { FadeRise } from '@/components/motion/fade-rise'
import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// A destination page, so every phase renders something — unlike the
// supplemental sections that vanish when they have nothing to say.
type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; attestations: LatestAttestation[] }

export default function AttestationsPage() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchLatestAttestations()
      if (cancelled) return
      if (result.status === 'error') {
        setState({ phase: 'error' })
        return
      }
      setState({ phase: 'ready', attestations: result.attestations })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col">
      <FadeRise className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-normal">Latest attestations</h1>
          <p className="text-base text-muted-foreground">
            The most recent aggregate Builder Score attestations on Base Sepolia. Each links to a
            full in-browser verification.
          </p>
        </header>

        {state.phase === 'loading' && (
          <div className="blueprint-grid relative overflow-hidden rounded-lg border bg-card/50 p-6">
            <SweepOverlay />
            <p className="flex items-center gap-2.5 text-base text-muted-foreground">
              <PingDot settled={false} /> Loading the latest attestations…
            </p>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-warning-text">Couldn&apos;t reach easscan — try again shortly.</p>
          </div>
        )}

        {state.phase === 'ready' && state.attestations.length === 0 && (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">No attestations yet.</p>
            <Link
              href={inputPath()}
              className="mt-2 inline-block text-sm text-success-text underline"
            >
              Get your score and be the first →
            </Link>
          </div>
        )}

        {state.phase === 'ready' && state.attestations.length > 0 && (
          <ul className="flex flex-col text-base">
            {state.attestations.map((a) => (
              <li
                key={a.uid}
                className="flex items-center justify-between gap-4 border-b border-border py-1.5 last:border-b-0"
              >
                <span className="text-foreground">
                  <span className="font-mono">{short(a.recipient)}</span> · {a.score} pts ·{' '}
                  {a.walletCount} wallets · spec v{a.specVersion} ·{' '}
                  {new Date(a.timeCreated * 1000).toISOString().slice(0, 10)}
                </span>
                <Link
                  href={verifyPath(a.uid)}
                  className="shrink-0 text-sm text-success-text underline"
                >
                  Verify →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </FadeRise>
    </main>
  )
}
