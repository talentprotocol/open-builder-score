import type { Metadata } from 'next'
import specJson from '../../../spec/spec.json'
import type { Spec } from '@/lib/types'
import {
  badgeSourceLabel,
  describeBadgeCheck,
  describeCalculation,
  describeValue,
  displayNote,
  formatFormula,
  groupCredentials,
} from '@/lib/credential-reference'
import { badgeDefinitions } from '@/lib/badges'
import { snapshotMeta } from '@/lib/snapshots'
import { Badge } from '@/components/ui/badge'
import { PingDot } from '@/components/motion/ping-dot'
import { FadeRise } from '@/components/motion/fade-rise'

const spec = specJson as Spec
const groups = groupCredentials(spec)
const credentialCount = groups.reduce((n, g) => n + g.credentials.length, 0)
const maxTotal = groups.reduce((n, g) => n + g.maxTotal, 0)

export const metadata: Metadata = {
  title: 'Builder Score credentials — Open Builder Score',
  description: `Every credential in the open Builder Score: what it measures, the exact formula, and the points it can earn — ${maxTotal} max.`,
}

export default function CredentialsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-10">
      <FadeRise className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-normal">Credentials</h1>
        <p className="text-base text-muted-foreground">
          Every point in a Builder Score comes from one of these {credentialCount} credentials —{' '}
          <span className="font-mono tabular-nums">{maxTotal}</span> max points. Same inputs, same
          score, for anyone.
        </p>
      </FadeRise>

      {groups.map((group) => (
        <FadeRise whileInView key={group.key}>
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <PingDot settled /> {group.label}
              </h2>
              <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground/70">
                {group.maxTotal} PTS
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {group.credentials.map((c) => (
                <article
                  key={c.slug}
                  id={c.slug}
                  className="flex scroll-mt-16 flex-col gap-1 rounded-lg border bg-card p-4 shadow-xs target:ring-1 target:ring-success/60 dark:bg-card/50"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-base font-medium">{c.name}</h3>
                    <span className="shrink-0 font-mono text-base tabular-nums tracking-tighter">
                      {c.max_score} pts
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Measures: {describeValue(c)}</p>
                  <p className="font-mono text-sm text-muted-foreground/80">{formatFormula(c)}</p>
                  {describeCalculation(c) && (
                    <Badge compact className="mt-1">
                      {describeCalculation(c)}
                    </Badge>
                  )}
                  {displayNote(c) && (
                    <p className="text-sm text-muted-foreground/80">{displayNote(c)}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        </FadeRise>
      ))}

      <FadeRise whileInView>
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <PingDot settled /> Badges
            </h2>
            <span className="font-mono text-xs tracking-[0.18em] text-muted-foreground/70">
              0 PTS
            </span>
          </div>
          <p className="text-base text-muted-foreground">
            Achievements shown next to a score without entering it. They add no points, so they
            cannot change a total or what an attestation says
            {snapshotMeta.generated_at
              ? `. Snapshot badges come from an export dated ${snapshotMeta.generated_at}`
              : ''}
            .
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {badgeDefinitions.map((badge) => (
              <article
                key={badge.slug}
                id={badge.slug}
                className="flex scroll-mt-16 flex-col gap-1 rounded-lg border bg-card p-4 shadow-xs target:ring-1 target:ring-success/60 dark:bg-card/50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-medium">{badge.name}</h3>
                  <span className="shrink-0 font-mono text-base tabular-nums tracking-tighter">
                    0 pts
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{badge.description}</p>
                <p className="font-mono text-sm text-muted-foreground/80">
                  {describeBadgeCheck(badge)}
                </p>
                <Badge compact className="mt-1">
                  {badgeSourceLabel(badge)}
                </Badge>
                {badge.notes && (
                  <p className="text-sm text-muted-foreground/80">{badge.notes}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      </FadeRise>
    </main>
  )
}
