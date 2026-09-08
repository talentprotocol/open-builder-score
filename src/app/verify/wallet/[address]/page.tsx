'use client'

import dynamic from 'next/dynamic'
import { ScanLoading } from '@/components/scan-loading'

const VerifyWalletView = dynamic(() => import('./verify-wallet-view'), {
  ssr: false,
  loading: () => <ScanLoading label="Finding the attestation for this wallet…" />,
})

export default function VerifyWalletPage(props: { params: Promise<{ address: string }> }) {
  return <VerifyWalletView {...props} />
}
