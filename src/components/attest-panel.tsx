'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { attestScore, ATTEST_CHAIN_ID, EASSCAN_SITE } from '@/lib/eas'
import { scorePath, verifyPath } from '@/lib/routes'
import { useGithubAuth } from '@/components/use-github-auth'
import { PingDot } from '@/components/motion/ping-dot'
import { FadeRise } from '@/components/motion/fade-rise'
import { Button } from '@/components/ui/button'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import type { Scored } from '@/lib/orchestrate'

const spec = specJson as Spec

const EXPLORER_BASE = `${EASSCAN_SITE}/attestation/view/`

export function AttestPanel({ scored }: { scored: Scored }) {
  const { address: connected, chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const auth = useGithubAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attestationUid, setAttestationUid] = useState<string | null>(null)

  if (!scored.score.complete || scored.gather.baseBlockNumber === null) {
    return (
      <p className="text-sm text-warning-text">
        Attestation is disabled while any source is unavailable — an attested score must be
        computed from complete data.
      </p>
    )
  }

  // The onchain schema anchors exactly one wallet; attesting an aggregate
  // would make recompute-and-verify diverge by construction.
  if (scored.extraAddresses.length > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This is an aggregate across {scored.extraAddresses.length + 1}{' '}
        wallets, and the attestation schema anchors exactly one wallet — so
        aggregate scores can&apos;t be attested.{' '}
        <Link
          href={scorePath(scored.address, scored.githubHandle)}
          className="text-success-text underline"
        >
          Score the primary wallet alone
        </Link>{' '}
        to attest it.
      </p>
    )
  }

  // Integrity gate: a handle-bearing attestation requires the signed-in
  // GitHub user to be that handle. Handle-less attestations are unrestricted.
  const handleVerified =
    scored.githubHandle === null ||
    (auth !== null && auth.login.toLowerCase() === scored.githubHandle.toLowerCase())
  if (!handleVerified) {
    return (
      <p className="text-sm text-warning-text">
        This score includes the GitHub handle @{scored.githubHandle}, which hasn&apos;t been
        verified. Sign in with GitHub on the form screen (Edit inputs) to prove it&apos;s yours
        before attesting.
      </p>
    )
  }

  async function handleSwitch() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await switchChainAsync({ chainId: ATTEST_CHAIN_ID })
      // On success wagmi re-renders with the target chain, swapping in the "Attest" button.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network switch failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleAttest() {
    // Only rendered on the target chain, so walletClient is the fresh, correct-chain client.
    if (!walletClient || busy) return
    setBusy(true)
    setError(null)
    try {
      const uid = await attestScore({
        walletClient,
        recipient: scored.address,
        specVersion: spec.version,
        githubHandle: scored.githubHandle,
        score: scored.score.total,
        computedAt: scored.gather.inputs.computedAt,
        blockNumber: scored.gather.baseBlockNumber!,
      })
      setAttestationUid(uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attestation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs dark:bg-card/50">
      <h2 className="text-base font-medium">Attest this score onchain</h2>
      <p className="text-sm text-muted-foreground">
        You sign, you pay. The attestation embeds the spec version, score, and the as-of anchor
        so anyone can recompute and verify it.
      </p>
      <div className="flex items-center gap-3">
        <ConnectButton showBalance={false} />
        {connected && chainId !== ATTEST_CHAIN_ID && (
          <Button onClick={handleSwitch} disabled={busy}>
            {busy ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Switching…
              </span>
            ) : (
              'Switch to Base Sepolia'
            )}
          </Button>
        )}
        {connected && chainId === ATTEST_CHAIN_ID && (
          <Button onClick={handleAttest} disabled={busy || !walletClient}>
            {busy ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Waiting for wallet…
              </span>
            ) : (
              'Attest onchain'
            )}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive-text break-all">{error}</p>}
      {attestationUid && (
        <FadeRise>
          <div className="flex flex-col gap-1">
            <a
              href={`${EXPLORER_BASE}${attestationUid}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-success-text underline break-all"
            >
              Attested — view {attestationUid} on easscan
            </a>
            <Link
              href={verifyPath(attestationUid)}
              className="text-sm text-success-text underline"
            >
              Verify it here
            </Link>
          </div>
        </FadeRise>
      )}
    </div>
  )
}
