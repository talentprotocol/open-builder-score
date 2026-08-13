'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { confirmOptOut, fetchOptOutStatus } from '@/lib/opt-out'
import { dataOptOutPath } from '@/lib/routes'
import { FadeRise } from '@/components/motion/fade-rise'
import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'
import { Button } from '@/components/ui/button'

// Render-only until the visitor acts: `fetchOptOutStatus` (a GET, on mount)
// only ever reads the token's state. `confirmOptOut` — the one call that
// actually opts the account out — fires exclusively from the button's
// onClick, never from an effect. Email clients and link scanners prefetch
// links like this one; a mutation on mount would opt users out before they
// ever saw the page.
type State =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'already-confirmed'; email: string }
  | { phase: 'ready'; email: string }
  | { phase: 'confirming'; email: string }
  | { phase: 'confirmed'; email: string }
  | { phase: 'error'; email: string; message: string }

export default function DataOptOutConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token: rawToken } = use(params)
  // Symmetric with dataOptOutConfirmPath, which encodeURIComponents the
  // token when building this link.
  let token = rawToken
  try {
    token = decodeURIComponent(rawToken)
  } catch {
    // Malformed percent-encoding: keep the raw segment; it fails upstream.
  }
  token = token.trim()

  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchOptOutStatus(token)
      if (cancelled) return
      if (result.status !== 'ready') {
        setState({ phase: 'invalid' })
        return
      }
      setState(
        result.confirmed
          ? { phase: 'already-confirmed', email: result.email }
          : { phase: 'ready', email: result.email },
      )
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleConfirm() {
    if (state.phase !== 'ready' && state.phase !== 'error') return
    const email = state.email
    setState({ phase: 'confirming', email })
    const outcome = await confirmOptOut(token)
    if (outcome.status === 'confirmed') {
      setState({ phase: 'confirmed', email: outcome.email })
      return
    }
    setState({
      phase: 'error',
      email,
      message:
        outcome.status === 'invalid'
          ? 'This link is no longer valid — it may have expired since you loaded this page.'
          : 'Something went wrong — please try again.',
    })
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-6">
      {state.phase === 'loading' && (
        <div className="blueprint-grid relative overflow-hidden rounded-lg border bg-card/50 p-6">
          <SweepOverlay />
          <p className="flex items-center gap-2.5 text-base text-muted-foreground">
            <PingDot settled={false} /> Checking your link…
          </p>
        </div>
      )}

      {state.phase === 'invalid' && (
        <FadeRise>
          <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4">
            <h1 className="text-base font-medium text-warning-text">
              This link is invalid or has expired.
            </h1>
            <p className="text-sm text-muted-foreground">
              Confirmation links only work for a limited time.{' '}
              <Link href={dataOptOutPath()} className="text-success-text underline">
                Request a fresh one
              </Link>
              .
            </p>
          </div>
        </FadeRise>
      )}

      {state.phase === 'already-confirmed' && (
        <FadeRise>
          <div className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success/10 p-4">
            <h1 className="text-base font-medium text-success-text">
              This email has already been opted out.
            </h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{state.email}</span> will not be part of the data
              transfer.
            </p>
          </div>
        </FadeRise>
      )}

      {(state.phase === 'ready' || state.phase === 'confirming' || state.phase === 'error') && (
        <FadeRise className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="font-heading text-xl font-normal">Confirm your opt-out</h1>
            <p className="text-base text-muted-foreground">
              You&apos;re about to opt out{' '}
              <span className="font-mono text-foreground">{state.email}</span> from the data
              transfer. Pressing the button below excludes this account&apos;s data from the
              transfer — this can&apos;t be undone from this page.
            </p>
          </header>
          <Button
            onClick={handleConfirm}
            className="self-start"
            disabled={state.phase === 'confirming'}
          >
            {state.phase === 'confirming' ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Confirming…
              </span>
            ) : (
              'Confirm opt-out'
            )}
          </Button>
          {state.phase === 'error' && (
            <p className="text-base text-destructive-text">{state.message}</p>
          )}
        </FadeRise>
      )}

      {state.phase === 'confirmed' && (
        <FadeRise>
          <div className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success/10 p-4">
            <h1 className="text-base font-medium text-success-text">
              {state.email} has been opted out of the data transfer.
            </h1>
          </div>
        </FadeRise>
      )}
    </main>
  )
}
