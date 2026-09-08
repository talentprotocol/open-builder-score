'use client'

import dynamic from 'next/dynamic'
import { ScanLoading } from '@/components/scan-loading'

// The results page gathers public data in the browser. SSR of that module
// graph was showing up as Fluid Active CPU on `/score/[wallet]`.
const ScoreWalletView = dynamic(() => import('./score-wallet-view'), {
  ssr: false,
  loading: () => <ScanLoading label="Scanning sources…" />,
})

export default function ResultsPage(props: { params: Promise<{ wallet: string }> }) {
  return <ScoreWalletView {...props} />
}
