import Link from 'next/link'
import type { BadgeResult } from '@/lib/types'
import { badgesPath } from '@/lib/routes'

// State is the only thing this strip says. How a badge is checked — and how
// strongly — is a question with a long answer, so it lives on /badges rather
// than being compressed into a column here.
const markStyles: Record<BadgeResult['state'], string> = {
  earned: 'bg-success',
  not_earned: 'border border-muted-foreground/50',
  unavailable: 'bg-warning',
}

const stateLabels: Record<BadgeResult['state'], string> = {
  earned: 'Earned',
  not_earned: 'Not earned',
  unavailable: 'Could not be checked',
}

export function BadgeStrip({ badges }: { badges: BadgeResult[] }) {
  if (badges.length === 0) return null
  const earned = badges.filter((b) => b.state === 'earned').length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground/70">
          Badges
        </h2>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground/70">
          {earned} of {badges.length} earned
        </span>
      </div>

      <ul className="divide-y divide-border border-y border-border">
        {badges.map((badge) => (
          <li key={badge.slug}>
            <Link
              href={badgesPath(badge.slug)}
              title={
                badge.state === 'unavailable'
                  ? `Couldn't check: ${badge.unavailableReason}`
                  : badge.description
              }
              className="flex items-baseline gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40"
            >
              <span className="flex h-[1.3125rem] shrink-0 items-center">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rotate-45 ${markStyles[badge.state]}`}
                />
              </span>
              <span
                className={`truncate ${
                  badge.state === 'earned'
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {badge.name}
                <span className="sr-only"> — {stateLabels[badge.state]}.</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground/70">
        No points — badges never affect the score or the attestation.{' '}
        <Link href={badgesPath()} className="underline hover:text-foreground">
          How each one is checked →
        </Link>
      </p>
    </section>
  )
}
