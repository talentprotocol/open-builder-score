import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Confirm data transfer opt-out',
  description:
    'Confirm that this account should be excluded from the transfer of Talent Protocol profile data to the company continuing the service.',
  // Per-token link, not a page anyone should land on from search.
  robots: { index: false },
}

export default function DataOptOutConfirmLayout({ children }: { children: React.ReactNode }) {
  return children
}
