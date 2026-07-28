import type { CredentialResult } from '@/lib/types'

const stateStyles: Record<CredentialResult['state'], string> = {
  earned: 'border-success/30 bg-success/10',
  not_earned: 'border-border bg-card opacity-70 dark:bg-card/50',
  unavailable: 'border-warning/30 bg-warning/10',
}

export function CredentialCard({ result }: { result: CredentialResult }) {
  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-1 shadow-xs ${stateStyles[result.state]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-base">{result.name}</h3>
        <span className="font-mono text-base tabular-nums tracking-tighter shrink-0">
          {result.points}/{result.maxScore}
        </span>
      </div>
      {result.state === 'unavailable' ? (
        <p className="text-sm text-warning">Couldn&apos;t check: {result.unavailableReason}</p>
      ) : result.rawValue === null ? (
        <p className="text-sm text-muted-foreground">Not earned</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Raw value: <span className="font-mono">{result.rawValue}</span>
          </p>
          <p className="text-sm text-muted-foreground/80 font-mono">{result.formula}</p>
        </>
      )}
    </div>
  )
}
