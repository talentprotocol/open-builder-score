import type { Metadata } from 'next'

// Shape-only: metadata doesn't need viem's checksum check, and importing
// viem here would put it on the server graph for every score-page request.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// Empty list: wallets arrive from the form and shareable links. Returning []
// still opts this segment into on-demand static generation so repeat visits
// (and crawlers) don't rerun Fluid CPU for a client-only page.
export function generateStaticParams() {
  return []
}

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
    // Malformed percent-encoding: keep the raw segment; it fails ADDRESS_RE below.
  }
  const title = ADDRESS_RE.test(wallet)
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
