import type { Metadata } from 'next'
import { isAddress } from 'viem'

// The results page must stay a client component (it computes in the browser),
// so per-link social metadata lives in this server-side segment layout.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>
}): Promise<Metadata> {
  const { wallet: rawWallet } = await params
  let wallet = rawWallet
  try {
    wallet = decodeURIComponent(rawWallet)
  } catch {
    // Malformed percent-encoding: keep the raw segment; it fails isAddress below.
  }
  const title = isAddress(wallet)
    ? `Builder Score — ${wallet.slice(0, 6)}…${wallet.slice(-4)}`
    : 'Builder Score'
  const description =
    'An explainable Builder Score computed entirely in the browser from public onchain and GitHub data. Open the link to recompute and verify it yourself.'
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  }
}

export default function ScoreResultsLayout({ children }: { children: React.ReactNode }) {
  return children
}
