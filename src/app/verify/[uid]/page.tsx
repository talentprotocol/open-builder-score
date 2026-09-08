'use client'

import dynamic from 'next/dynamic'
import { ScanLoading } from '@/components/scan-loading'

// Scoring, RPC fan-out, and viem stay in the view — `ssr: false` keeps that
// graph off the server. Fluid CPU was dominated by SSR of this page.
const VerifyUidView = dynamic(() => import('./verify-uid-view'), {
  ssr: false,
  loading: () => <ScanLoading label="Fetching attestation…" />,
})

export default function VerifyUidPage(props: { params: Promise<{ uid: string }> }) {
  return <VerifyUidView {...props} />
}
