import type { Metadata } from 'next'
import Link from 'next/link'
import { privacyPath } from '@/lib/routes'
import { FadeRise } from '@/components/motion/fade-rise'

export const metadata: Metadata = {
  title: 'Terms of Service — Builder Score',
  description: 'The terms under which the Builder Score public-good app is provided.',
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

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-10">
      <FadeRise className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-normal">Terms of Service</h1>
        <p className={p}>
          Effective 19 August 2026. The Builder Score app is operated by Reputation DAO LLC
          (&ldquo;Talent Protocol&rdquo;, &ldquo;we&rdquo;) as a free public good.
        </p>
      </FadeRise>

      <FadeRise whileInView className="flex flex-col gap-8">
        <Section title="What this service is">
          <p className={p}>
            The app computes an explainable Builder Score in your browser from public
            data — onchain activity and public GitHub metrics. There are no accounts and no fees.
            The scoring logic is open source and anyone can recompute any score from the same
            public inputs.
          </p>
        </Section>

        <Section title="No warranties, no advice">
          <p className={p}>
            The service is provided as-is, without warranties of any kind. A score is an
            automated summary of public data: it can be incomplete, stale, or wrong, and the
            third-party sources it reads (public RPC endpoints, the GitHub API, the EAS index)
            can fail or change. A score is not an endorsement, a credential, or financial,
            employment, or any other kind of advice, and must not be used as the sole basis for
            any decision about a person.
          </p>
        </Section>

        <Section title="Onchain attestations">
          <p className={p}>
            Attesting a score is an optional, user-initiated transaction on the Base network,
            signed by your own wallet and paid for by you. Attestations are public and permanent:
            we do not control the blockchain and cannot edit or delete onchain records. Revoking
            an attestation marks it revoked but does not erase it. Only attest data you are
            comfortable publishing forever.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p className={p}>
            Don&apos;t abuse the service: no attempts to overload it or the third-party APIs it
            relies on, no misrepresenting scores or attestations as something they are not, and
            no unlawful use. Attestations that carry a GitHub handle require signing in as that
            handle; circumventing that check is a misuse of the service.
          </p>
        </Section>

        <Section title="Third-party services">
          <p className={p}>
            Your browser talks directly to public blockchain RPC providers, the GitHub API, and
            the EAS index (easscan.org). Those services have their own terms, and we are not
            responsible for them. Wallet connections are handled by your own wallet software.
          </p>
        </Section>

        <Section title="Availability">
          <p className={p}>
            This app is maintained part-time as a public good, with no service-level commitment.
            We currently plan to keep it running through the end of 2026; it may change or shut
            down after that. Because scoring and verification are open source and run on public
            data, anyone can keep computing scores without us.
          </p>
        </Section>

        <Section title="Intellectual property">
          <p className={p}>
            The source code is open source in the{' '}
            <a
              href="https://github.com/talentprotocol/open-builder-score"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              talentprotocol/open-builder-score
            </a>{' '}
            repository under its stated license. Talent Protocol names and logos remain the
            property of Reputation DAO LLC.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p className={p}>
            We may update these terms; the effective date above changes when we do. Continued use
            after a change means you accept it. These terms are governed by the laws of the
            Republic of the Marshall Islands. Questions: {CONTACT}. See also the{' '}
            <Link href={privacyPath()} className="underline hover:text-foreground">
              privacy policy
            </Link>
            .
          </p>
        </Section>
      </FadeRise>
    </main>
  )
}
