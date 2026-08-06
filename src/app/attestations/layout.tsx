import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Latest Builder Score attestations',
  description:
    'The most recent Builder Score attestations onchain — each one verifiable in your browser from public data.',
}

export default function AttestationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
