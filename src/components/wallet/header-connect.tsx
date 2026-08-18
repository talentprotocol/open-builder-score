'use client'

import { useEffect, useRef } from 'react'
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { WalletProviders } from '@/components/wallet/wallet-providers'

// Mounted by the header only after the visitor clicks Connect (autoOpen) or
// arrives with a persisted wagmi session — see Header. Self-wrapped in
// WalletProviders so the wallet stack ships in this lazy chunk, not in the
// layout every page loads.
export default function HeaderConnect({ autoOpen }: { autoOpen: boolean }) {
  return (
    <WalletProviders>
      <HeaderConnectInner autoOpen={autoOpen} />
    </WalletProviders>
  )
}

function HeaderConnectInner({ autoOpen }: { autoOpen: boolean }) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const opened = useRef(false)

  // The visitor clicked the placeholder button, so the modal they asked for
  // opens as soon as RainbowKit can show it — unless a persisted session
  // reconnected meanwhile, in which case there is nothing left to connect.
  useEffect(() => {
    if (!autoOpen || opened.current || isConnected) return
    if (openConnectModal) {
      opened.current = true
      openConnectModal()
    }
  }, [autoOpen, isConnected, openConnectModal])

  return <ConnectButton showBalance={false} chainStatus="none" />
}
