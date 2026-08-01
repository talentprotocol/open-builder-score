import Link from 'next/link'
import type { BadgeResult } from '@/lib/types'
import { credentialsPath } from '@/lib/routes'

const pillStyles: Record<BadgeResult['state'], string> = {
  earned: 'border-success/30 bg-success/10 text-foreground',
  not_earned: 'border-border bg-card text-muted-foreground opacity-70 dark:bg-card/50',
  unavailable: 'border-warning/30 bg-warning/10 text-warning-text',
}

const dotStyles: Record<BadgeResult['state'], string> = {
  earned: 'bg-success',
  not_earned: 'bg-muted-foreground/40',
  unavailable: 'bg-warning',
}

function pillTitle(badge: BadgeResult): string {
  if (badge.state === 'unavailable') return `Couldn't check: ${badge.unavailableReason}`
  return badge.description
}

export function BadgeStrip({ badges }: { badges: BadgeResult[] }) {
  if (badges.length === 0) return null
  // Snapshot badges are read from a dated export, not recomputed live. That
  // difference is the one thing this strip must not blur.
  // asOf is set by evaluateBadges on any badge that consults a snapshot, which
  // is not the same as a badge whose primary source is one.
  const asOf = badges.find((b) => b.asOf)?.asOf

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground/70">
          Badges
        </h2>
        <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground/70">0 PTS</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <li key={badge.slug}>
            <span
              title={pillTitle(badge)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${pillStyles[badge.state]}`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotStyles[badge.state]}`}
              />
              {badge.name}
              {badge.source === 'snapshot' && (
                <span className="font-mono text-xs text-muted-foreground/70">snapshot</span>
              )}
              {badge.source !== 'snapshot' && badge.asOf && (
                <span className="font-mono text-xs text-muted-foreground/70">+ snapshot</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground/70">
        Badges carry no points and never affect the score or the attestation.{' '}
        {asOf && `Snapshot badges are read from an export dated ${asOf}. `}
        <Link href={credentialsPath()} className="underline hover:text-foreground">
          How each one is checked →
        </Link>
      </p>
    </section>
  )
}
