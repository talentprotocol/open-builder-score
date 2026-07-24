'use client'

import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { attestScore, ATTEST_CHAIN_ID } from '@/lib/eas'
import type { Scored } from '@/app/page'

const EXPLORER_BASE =
  ATTEST_CHAIN_ID === 84532
    ? 'https://base-sepolia.easscan.org/attestation/view/'
    : 'https://base.easscan.org/attestation/view/'

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

  async function handleAttest() {
    if (!walletClient) return
    setBusy(true)
    setError(null)
    try {
      if (chainId !== ATTEST_CHAIN_ID) await switchChainAsync({ chainId: ATTEST_CHAIN_ID })
      const uid = await attestScore({
        walletClient,
        recipient: scored.address,
        specVersion: '0.1.0-poc',
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
        {connected && (
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
        <a
          href={`${EXPLORER_BASE}${attestationUid}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-emerald-400 underline break-all"
        >
          Attested — view {attestationUid} on easscan
        </a>
      )}
    </div>
  )
}
