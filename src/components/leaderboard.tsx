'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchLatestAttestations, type LatestAttestation } from '@/lib/latest'
import { buildLeaderboard, LEADERBOARD_TAKE } from '@/lib/leaderboard'
import { attestationsPath, inputPath, verifyPath } from '@/lib/routes'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; rows: LatestAttestation[] }

export function Leaderboard() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetchLatestAttestations(fetch, { take: LEADERBOARD_TAKE }).then((result) => {
      if (cancelled) return
      if (result.status !== 'ok') {
        setState({ phase: 'error' })
        return
      }
      setState({ phase: 'ready', rows: buildLeaderboard(result.attestations) })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-lg font-normal">Leaderboard</h2>
        <Link
          href={attestationsPath()}
          className="text-sm text-muted-foreground underline transition-colors hover:text-foreground"
        >
          See all attestations →
        </Link>
      </div>

      {state.phase === 'loading' && (
        <div className="rounded-lg border bg-card p-4 dark:bg-card/50">
          <p className="text-sm text-muted-foreground">Loading attested scores…</p>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="rounded-lg border bg-card p-4 dark:bg-card/50">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t reach easscan — the leaderboard will be back shortly.
          </p>
        </div>
      )}

      {state.phase === 'ready' && state.rows.length === 0 && (
        <div className="rounded-lg border bg-card p-4 dark:bg-card/50">
          <p className="text-sm text-muted-foreground">No attested scores yet.</p>
          <Link
            href={inputPath()}
            className="mt-2 inline-block text-sm text-success-text underline"
          >
            Get your score and be the first →
          </Link>
        </div>
      )}

      {state.phase === 'ready' && state.rows.length > 0 && (
        <table className="w-full table-fixed border-collapse text-base">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[34%]" />
            <col className="w-[18%]" />
            <col className="w-[22%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2.5 text-left text-sm font-medium text-muted-foreground">
                #
              </th>
              <th scope="col" className="py-2.5 text-left text-sm font-medium text-muted-foreground">
                Builder
              </th>
              <th scope="col" className="py-2.5 text-left text-sm font-medium text-muted-foreground">
                Score
              </th>
              <th scope="col" className="py-2.5 text-left text-sm font-medium text-muted-foreground">
                Attested
              </th>
              <th scope="col" className="py-2.5 text-right text-sm font-medium text-muted-foreground">
                Verify
              </th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, i) => (
              <tr
                key={row.uid}
                className="border-b border-border transition-colors last:border-b-0 hover:bg-accent/60"
              >
                <td className="py-2.5 font-mono text-sm text-muted-foreground">{i + 1}</td>
                <td className="py-2.5 font-mono">{short(row.recipient)}</td>
                <td className="py-2.5 tabular-nums">{row.score} pts</td>
                <td className="py-2.5 tabular-nums text-muted-foreground">
                  {new Date(row.timeCreated * 1000).toISOString().slice(0, 10)}
                </td>
                <td className="py-2.5 text-right">
                  <Link href={verifyPath(row.uid)} className="text-sm text-success-text underline">
                    Verify →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
