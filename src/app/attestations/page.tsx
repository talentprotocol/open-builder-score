'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react/dist/ssr'
import {
  ATTESTATIONS_PAGE_SIZE,
  paginateAttestations,
  sortAttestations,
  type AttestationSortDir,
  type AttestationSortKey,
} from '@/lib/attestations-table'
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

function SortHeader({
  label,
  column,
  activeKey,
  dir,
  onSort,
}: {
  label: string
  column: AttestationSortKey
  activeKey: AttestationSortKey
  dir: AttestationSortDir
  onSort: (key: AttestationSortKey) => void
}) {
  const active = activeKey === column
  const Icon = dir === 'asc' ? CaretUpIcon : CaretDownIcon
  return (
    <th scope="col" className="py-2.5 text-left text-sm font-medium text-muted-foreground">
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        <Icon
          className={`size-3 ${active ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden
        />
      </button>
    </th>
  )
}

export default function AttestationsPage() {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [sortKey, setSortKey] = useState<AttestationSortKey>('date')
  const [sortDir, setSortDir] = useState<AttestationSortDir>('desc')
  const [page, setPage] = useState(1)

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

  const sorted = useMemo(() => {
    if (state.phase !== 'ready') return []
    return sortAttestations(state.attestations, sortKey, sortDir)
  }, [state, sortKey, sortDir])

  const paged = useMemo(
    () => paginateAttestations(sorted, page, ATTESTATIONS_PAGE_SIZE),
    [sorted, page],
  )

  function handleSort(key: AttestationSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-12">
      <FadeRise className="flex flex-1 flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-normal">Latest attestations</h1>
          <p className="text-base text-muted-foreground">
            The most recent aggregate Builder Score attestations on Base. Each links to a
            full in-browser verification.
          </p>
        </header>

        {state.phase === 'loading' && (
          <div className="blueprint-grid relative flex flex-1 items-center overflow-hidden rounded-lg border bg-card/50 p-6">
            <SweepOverlay />
            <p className="flex items-center gap-2.5 text-base text-muted-foreground">
              <PingDot settled={false} /> Loading the latest attestations…
            </p>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="flex flex-1 items-center rounded-lg border bg-card p-4">
            <p className="text-sm text-warning-text">
              Couldn&apos;t reach easscan — try again shortly.
            </p>
          </div>
        )}

        {state.phase === 'ready' && state.attestations.length === 0 && (
          <div className="flex flex-1 flex-col justify-center rounded-lg border bg-card p-4">
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
          <div className="flex flex-col gap-3">
            <table className="w-full table-fixed border-collapse text-base">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[18%]" />
                <col className="w-[28%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="py-2.5 text-left text-sm font-medium text-muted-foreground"
                  >
                    Recipient
                  </th>
                  <SortHeader
                    label="Score"
                    column="score"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Date"
                    column="date"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  <th
                    scope="col"
                    className="py-2.5 text-right text-sm font-medium text-muted-foreground"
                  >
                    Verify
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((a) => (
                  <tr
                    key={a.uid}
                    className="border-b border-border transition-colors last:border-b-0 hover:bg-accent/60"
                  >
                    <td className="py-2.5 font-mono">{short(a.recipient)}</td>
                    <td className="py-2.5 tabular-nums">{a.score} pts</td>
                    <td className="py-2.5 tabular-nums text-muted-foreground">
                      {new Date(a.timeCreated * 1000).toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={verifyPath(a.uid)}
                        className="text-sm text-success-text underline"
                      >
                        Verify →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {paged.totalPages > 1 && (
              <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                <span>
                  {paged.from}–{paged.to} of {paged.total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={paged.page <= 1}
                    onClick={() => setPage(paged.page - 1)}
                    className="rounded-md border border-border px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={paged.page >= paged.totalPages}
                    onClick={() => setPage(paged.page + 1)}
                    className="rounded-md border border-border px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </FadeRise>
    </main>
  )
}
