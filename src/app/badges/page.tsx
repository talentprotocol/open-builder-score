import type { Metadata } from 'next'
import Link from 'next/link'
import { badgeDefinitions } from '@/lib/badges'
import { describeBadgeCheck } from '@/lib/badge-reference'
import { credentialsPath } from '@/lib/routes'
import { FadeRise } from '@/components/motion/fade-rise'

export const metadata: Metadata = {
  title: 'Badges — Open Builder Score',
  description: 'What each badge means and how it is checked. Badges carry no points.',
}

export default function BadgesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-10">
      <FadeRise className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-normal">Badges</h1>
        <p className="text-base text-muted-foreground">
          Achievements shown beside a score. They carry no points; points come from{' '}
          <Link href={credentialsPath()} className="underline hover:text-foreground">
            credentials
          </Link>
          .
        </p>
      </FadeRise>

      <FadeRise whileInView>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {badgeDefinitions.map((badge) => (
            <article
              key={badge.slug}
              id={badge.slug}
              className="flex scroll-mt-16 flex-col gap-1 rounded-lg border bg-card p-4 shadow-xs target:ring-1 target:ring-success/60 dark:bg-card/50"
            >
              <h2 className="text-base font-medium">{badge.name}</h2>
              <p className="text-sm text-muted-foreground">{badge.description}</p>
              <p className="font-mono text-sm text-muted-foreground/80">
                {describeBadgeCheck(badge)}
              </p>
            </article>
          ))}
        </div>
      </FadeRise>
    </main>
  )
}
