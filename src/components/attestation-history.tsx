'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchScoreAttestationHistory, type ScoreAttestationSummary } from '@/lib/history'
import { verifyPath } from '@/lib/routes'

// Supplemental section: renders nothing while loading, on error, or when empty.
export function AttestationHistory({ wallet }: { wallet: `0x${string}` }) {
  const [attestations, setAttestations] = useState<ScoreAttestationSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchScoreAttestationHistory(wallet)
      if (!cancelled && result.status === 'ok') setAttestations(result.attestations)
    })()
    return () => {
      cancelled = true
    }
  }, [wallet])

  if (!attestations || attestations.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-400">Attestation history</h2>
      <ul className="flex flex-col text-sm">
        {attestations.map((a) => (
          <li
            key={a.uid}
            className="flex items-center justify-between gap-4 border-b border-zinc-800 py-1.5 last:border-b-0"
          >
            <span className={a.revoked ? 'text-zinc-600 line-through' : 'text-zinc-300'}>
              {a.score} pts · spec v{a.specVersion} ·{' '}
              {new Date(a.timeCreated * 1000).toISOString().slice(0, 10)}
              {a.revoked && ' · revoked'}
            </span>
            <Link href={verifyPath(a.uid)} className="shrink-0 text-xs text-emerald-400 underline">
              Verify →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
