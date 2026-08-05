'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAddress } from 'viem'
import { fetchScoreAttestationHistory } from '@/lib/history'
import { verifyPath } from '@/lib/routes'
import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'

// An attestation cannot link to itself — EAS hashes the record's own data and
// block.timestamp into the UID — so `verify_url` points here instead, keyed on
// the recipient wallet, which is known before the record exists. This resolves to
// that wallet's most recent attestation and hands off to the verify view.
type State = { phase: 'loading' } | { phase: 'error'; reason: string } | { phase: 'none' }

export default function VerifyWalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = use(params)
  const address = raw.trim()
  const router = useRouter()
  // Derived during render, not stored: whether the path segment is an address is
  // knowable without talking to anything, so making it effect state would just
  // schedule an extra render to learn what we already know.
  const valid = isAddress(address)
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    ;(async () => {
      const result = await fetchScoreAttestationHistory(address)
      if (cancelled) return
      if (result.status === 'error') {
        setState({ phase: 'error', reason: 'could not reach easscan' })
        return
      }
      const live = result.attestations.filter((a) => !a.revoked)
      if (live.length === 0) {
        setState({ phase: 'none' })
        return
      }
      // History is newest-first. One attestation is the expected case; more than
      // one means the wallet was re-scored, and the newest is the current claim.
      router.replace(verifyPath(live[0].uid))
    })()
    return () => {
      cancelled = true
    }
  }, [address, valid, router])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-6">
      {!valid && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-warning-text">
            That isn&apos;t a valid EVM address, so there is nothing to look up.
          </p>
          <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{address}</p>
        </div>
      )}

      {valid && state.phase === 'loading' && (
        <div className="blueprint-grid relative overflow-hidden rounded-lg border bg-card/50 p-6">
          <SweepOverlay />
          <p className="flex items-center gap-2.5 text-base text-muted-foreground">
            <PingDot settled={false} /> Finding the attestation for this wallet…
          </p>
        </div>
      )}

      {valid && state.phase === 'error' && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-warning-text">Couldn&apos;t look this up — {state.reason}.</p>
          <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{address}</p>
        </div>
      )}

      {valid && state.phase === 'none' && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            No attestation found for <span className="break-all font-mono">{address}</span>.
          </p>
          <Link href={verifyPath()} className="mt-2 inline-block text-sm text-success-text underline">
            Verify a specific attestation by UID →
          </Link>
        </div>
      )}
    </main>
  )
}
