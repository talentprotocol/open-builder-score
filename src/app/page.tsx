import type { Metadata } from 'next'
import Link from 'next/link'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import { scannedChainCount } from '@/lib/credential-reference'
import { credentialsPath } from '@/lib/routes'
import { LandingCta } from '@/components/landing-cta'
import { HeroScan } from '@/components/hero-scan'
import { Leaderboard } from '@/components/leaderboard'
import { FadeRise } from '@/components/motion/fade-rise'

const spec = specJson as Spec

export const metadata: Metadata = {
  title: 'Check Your Builder Score | Talent Protocol',
  description:
    'Calculate a score based on your public GitHub and blockchain activity. Fully transparent and runs in your browser. No account required.',
}

const VALUE_PROPS: { title: string; body: string; link?: { href: string; label: string } }[] = [
  {
    title: 'Computed in your browser',
    body: 'Public RPC and public APIs only — no accounts, and nothing leaves your machine except the queries themselves.',
  },
  {
    title: 'Attested onchain',
    body: 'One click publishes an EAS attestation on Base that anyone can verify by recomputing the score.',
  },
  {
    title: 'Anyone can run it',
    body: 'Open spec, open math. The same inputs always produce the same score.',
    link: { href: credentialsPath(), label: 'See every credential →' },
  },
]

const STEPS = [
  'Enter any wallet address or ENS name — and optionally a GitHub handle.',
  `Your browser queries public data across ${scannedChainCount(spec)} chains and GitHub.`,
  'Every point comes with the exact formula that produced it.',
  'Optionally attest the score on Base — verifiable by anyone.',
]

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 flex flex-col gap-16">
      <section className="flex flex-col items-start gap-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-4">
          <h1 className="font-heading text-2xl font-normal tracking-tight">
            Calculate your Builder Score and put it onchain.
          </h1>
          <p className="max-w-xl text-muted-foreground">
            Turn your public GitHub and blockchain activity into a verified reputation score.
            Everything runs in your browser using open rules, with no account required.
          </p>
          <LandingCta />
        </div>
        <HeroScan />
      </section>

      <FadeRise whileInView>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {VALUE_PROPS.map((prop) => (
            <div key={prop.title} className="rounded-lg border bg-card p-4 shadow-xs dark:bg-card/50">
              <h2 className="text-base font-medium">{prop.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{prop.body}</p>
              {prop.link && (
                <p className="mt-2 text-sm">
                  <Link
                    href={prop.link.href}
                    className="text-muted-foreground underline transition-colors hover:text-foreground"
                  >
                    {prop.link.label}
                  </Link>
                </p>
              )}
            </div>
          ))}
        </section>
      </FadeRise>

      <FadeRise whileInView>
        <Leaderboard />
      </FadeRise>

      <FadeRise whileInView>
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-normal">How it works</h2>
          <ol className="flex flex-col gap-3">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-baseline gap-3 text-base text-foreground">
                <span className="font-mono text-sm text-muted-foreground">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      </FadeRise>
    </main>
  )
}
