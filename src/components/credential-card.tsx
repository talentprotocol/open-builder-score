import type { CredentialResult } from '@/lib/types'

const stateStyles: Record<CredentialResult['state'], string> = {
  earned: 'border-emerald-500/40 bg-emerald-500/5',
  not_earned: 'border-zinc-700 bg-zinc-900/40 opacity-70',
  unavailable: 'border-amber-500/40 bg-amber-500/5',
}

export function CredentialCard({ result }: { result: CredentialResult }) {
  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-1 ${stateStyles[result.state]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-sm">{result.name}</h3>
        <span className="font-mono text-sm tabular-nums shrink-0">
          {result.points}/{result.maxScore}
        </span>
      </div>
      {result.state === 'unavailable' ? (
        <p className="text-xs text-amber-500">Couldn&apos;t check: {result.unavailableReason}</p>
      ) : result.rawValue === null ? (
        <p className="text-xs text-zinc-500">Not earned</p>
      ) : (
        <>
          <p className="text-xs text-zinc-400">
            Raw value: <span className="font-mono">{result.rawValue}</span>
          </p>
          <p className="text-xs text-zinc-500 font-mono">{result.formula}</p>
        </>
      )}
    </div>
  )
}
