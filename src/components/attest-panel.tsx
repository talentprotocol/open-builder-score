'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { attestScore, ATTEST_CHAIN_ID, EASSCAN_SITE } from '@/lib/eas'
import { verifyPath } from '@/lib/routes'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import type { Scored } from '@/lib/orchestrate'

const spec = specJson as Spec

const EXPLORER_BASE = `${EASSCAN_SITE}/attestation/view/`

export function AttestPanel({ scored }: { scored: Scored }) {
  const { address: connected, chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attestationUid, setAttestationUid] = useState<string | null>(null)

  if (!scored.score.complete || scored.gather.baseBlockNumber === null) {
    return (
      <p className="text-xs text-amber-500">
        Attestation is disabled while any source is unavailable — an attested score must be
        computed from complete data.
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
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 p-4">
      <h2 className="text-sm font-medium">Attest this score onchain</h2>
      <p className="text-xs text-zinc-500">
        You sign, you pay. The attestation embeds the spec version, score, and the as-of anchor
        so anyone can recompute and verify it.
      </p>
      <div className="flex items-center gap-3">
        <ConnectButton showBalance={false} />
        {connected && chainId !== ATTEST_CHAIN_ID && (
          <button
            onClick={handleSwitch}
            disabled={busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Switching…' : 'Switch to Base Sepolia'}
          </button>
        )}
        {connected && chainId === ATTEST_CHAIN_ID && (
          <button
            onClick={handleAttest}
            disabled={busy || !walletClient}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Waiting for wallet…' : 'Attest onchain'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400 break-all">{error}</p>}
      {attestationUid && (
        <div className="flex flex-col gap-1">
          <a
            href={`${EXPLORER_BASE}${attestationUid}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-emerald-400 underline break-all"
          >
            Attested — view {attestationUid} on easscan
          </a>
          <Link
            href={verifyPath(attestationUid)}
            className="text-xs text-emerald-400 underline"
          >
            Verify it here
          </Link>
        </div>
      )}
    </div>
  )
}
