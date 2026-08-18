'use client'

import { useEffect } from 'react'
import { useAccount } from 'wagmi'
import { WalletProviders } from '@/components/wallet/wallet-providers'

// Mounted by the score form only when a persisted wagmi session exists — its
// sole job is to hand the reconnected address to the form's prefill callback.
// Renders nothing.
export default function WalletPrefill({ onAddress }: { onAddress: (address: string) => void }) {
  return (
    <WalletProviders>
      <PrefillInner onAddress={onAddress} />
    </WalletProviders>
  )
}

function PrefillInner({ onAddress }: { onAddress: (address: string) => void }) {
  const { address } = useAccount()
  useEffect(() => {
    if (address) onAddress(address)
  }, [address, onAddress])
  return null
}
