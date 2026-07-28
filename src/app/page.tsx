import type { Metadata } from 'next'
import { LandingCta } from '@/components/landing-cta'
import { HeroScan } from '@/components/hero-scan'
import { FadeRise } from '@/components/motion/fade-rise'

export const metadata: Metadata = {
  title: 'Open Builder Score — an open score anyone can compute',
  description:
    'An open Builder Score anyone can compute in their browser from public onchain and GitHub data — with the exact math behind every point, attestable on Base.',
}

const VALUE_PROPS = [
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
  },
]

const STEPS = [
  'Enter any wallet address or ENS name — and optionally a GitHub handle.',
  'Your browser queries public data across 6 chains and GitHub.',
  'Every point comes with the exact formula that produced it.',
  'Optionally attest the score on Base — verifiable by anyone.',
]

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 flex flex-col gap-16">
      <section className="flex flex-col items-start gap-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-4">
          <h1 className="font-heading text-2xl font-normal tracking-tight">
            A builder score you don&apos;t have to trust.
          </h1>
          <p className="max-w-xl text-muted-foreground">
            An open score anyone can compute — explainable, computed in your browser from public
            data, and attestable onchain.
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
            </div>
          ))}
        </section>
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
