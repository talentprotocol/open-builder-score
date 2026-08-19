import type { Metadata } from 'next'
import Link from 'next/link'
import { termsPath } from '@/lib/routes'
import { FadeRise } from '@/components/motion/fade-rise'

export const metadata: Metadata = {
  title: 'Privacy Policy — Builder Score',
  description:
    'What the Builder Score app processes, where it happens, and the one thing we store: data-transfer opt-outs.',
}

const CONTACT = 'contact@talentprotocol.com'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
  )
}

const p = 'text-base text-muted-foreground'

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-10">
      <FadeRise className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-normal">Privacy Policy</h1>
        <p className={p}>
          Effective 19 August 2026. The data controller is Reputation DAO LLC
          (&ldquo;Talent Protocol&rdquo;), reachable at {CONTACT}.
        </p>
        <p className={p}>
          The short version: scoring happens in your browser, we run no accounts, and the only
          personal data we store server-side is the opt-out register described below.
        </p>
      </FadeRise>

      <FadeRise whileInView className="flex flex-col gap-8">
        <Section title="Scoring happens in your browser">
          <p className={p}>
            When you check a score, the wallet addresses, ENS names, or GitHub handles you enter
            are processed by code running in your own browser. Your browser fetches the public
            data directly from public blockchain RPC endpoints, the GitHub API, and the EAS index
            (easscan.org) — those requests never pass through our servers, so we do not see or
            store what you look up. Those third parties see the requests your browser makes to
            them, under their own privacy policies.
          </p>
        </Section>

        <Section title="Hosting logs">
          <p className={p}>
            The app is served by Vercel, which produces standard, short-lived request logs (IP
            address, user agent, requested URL) for the pages and static files it serves — not
            for the scoring lookups above, which skip our infrastructure entirely. We run no
            analytics, no advertising, and no tracking cookies.
          </p>
        </Section>

        <Section title="Optional GitHub sign-in">
          <p className={p}>
            Signing in with GitHub is only needed to attest a score that carries your GitHub
            handle. The access token lives in your browser (per-tab session storage; a short-lived
            cookie exists only during the sign-in handshake) and is used to read your public
            GitHub profile and contribution metrics. We do not store it server-side, and signing
            out or closing the tab discards it.
          </p>
        </Section>

        <Section title="What stays on your device">
          <p className={p}>
            Your theme choice, wallet-connection state, and attestation signing session are kept
            in your browser&apos;s local storage and never sent to us. Connecting a wallet is
            handled by your own wallet software.
          </p>
        </Section>

        <Section title="Attestations are public by design">
          <p className={p}>
            If you attest a score, the attested data — your wallet addresses, score, GitHub
            handle if included, badges, and ownership signatures — is written to the Base
            blockchain. Onchain data is public, permanent, and outside anyone&apos;s ability to
            delete, including ours. Attesting is always your explicit choice, made in your
            wallet.
          </p>
        </Section>

        <Section title="The one thing we store: data-transfer opt-outs">
          <p className={p}>
            The opt-out flow at optout.talentprotocol.com exists so people can opt out of the
            one-time transfer of Talent Protocol builder records to IPTS. If you use it, we store
            the email address you submit, a hashed confirmation token, and timestamps in our
            database (hosted on Supabase), and we send you one confirmation email via SendGrid,
            our email processor. A confirmed opt-out is shared with IPTS so the corresponding
            record is removed. We keep opt-out records for as long as needed to honor them. The
            legal basis is our legitimate interest in honoring your objection to the transfer.
          </p>
        </Section>

        <Section title="Your rights">
          <p className={p}>
            You can ask us what we hold about you, ask for it to be corrected or deleted, or
            object to processing by writing to {CONTACT}. For the opt-out register that covers
            everything; for anything already onchain, deletion is technically impossible — we
            will explain what can and cannot be done in each case. If you are in a jurisdiction
            with a data-protection authority, you also have the right to complain to it.
          </p>
        </Section>

        <Section title="Changes">
          <p className={p}>
            We may update this policy; the effective date above changes when we do. See also the{' '}
            <Link href={termsPath()} className="underline hover:text-foreground">
              terms of service
            </Link>
            .
          </p>
        </Section>
      </FadeRise>
    </main>
  )
}
