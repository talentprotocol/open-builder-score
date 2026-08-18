import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Data transfer opt-out',
  description:
    'Opt out of having your Talent Protocol profile data transferred to the company continuing the service.',
  // Temporary, single-purpose flow tied to individual email links — nothing
  // here belongs in a search index.
  robots: { index: false },
}

export default function DataOptOutLayout({ children }: { children: React.ReactNode }) {
  return children
}
