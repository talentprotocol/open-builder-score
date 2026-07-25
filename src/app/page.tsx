import type { Metadata } from 'next'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import { LandingCta } from '@/components/landing-cta'

const spec = specJson as Spec

export const metadata: Metadata = {
  title: 'Open Builder Score — an explainable, attestable builder score',
  description:
    'Compute a Builder Score entirely in your browser from public onchain and GitHub data, see the exact math behind every point, and attest it on Base.',
}

const VALUE_PROPS = [
  {
    title: 'Computed in your browser',
    body: 'Public RPC and public APIs only. No backend, no accounts — nothing leaves your machine except the queries themselves.',
  },
  {
    title: 'Attested onchain',
    body: 'One click publishes an EAS attestation on Base that anyone can verify by recomputing the score.',
  },
  {
    title: 'Anyone can run it',
    body: `Open spec (v${spec.version}), open math. The same inputs always produce the same score.`,
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
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight">
          A builder score you don&apos;t have to trust.
        </h1>
        <p className="max-w-xl text-zinc-400">
          Open Builder Score computes an explainable Builder Score entirely in your browser from
          public data — then lets you attest it onchain.
        </p>
        <LandingCta />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map((prop) => (
          <div key={prop.title} className="rounded-lg border border-zinc-800 p-4">
            <h2 className="text-sm font-medium">{prop.title}</h2>
            <p className="mt-2 text-xs text-zinc-400">{prop.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-baseline gap-3 text-sm text-zinc-300">
              <span className="font-mono text-xs text-emerald-500">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
