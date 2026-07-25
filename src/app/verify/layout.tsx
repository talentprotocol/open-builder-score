import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Verify a Builder Score attestation',
  description:
    'Paste an attestation UID: your browser fetches it, recomputes the score from public data, and compares the two.',
}

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children
}
