'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { inputPath } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { WalletProviders } from '@/components/wallet/wallet-providers'

// Mounted by LandingCta only after a click (autoStart) or when a persisted
// wagmi session exists — the connect-then-route logic lives here so the
// wallet stack stays out of the homepage's first load.
export default function LandingCtaIsland({ autoStart }: { autoStart: boolean }) {
  return (
    <WalletProviders>
      <CtaInner autoStart={autoStart} />
    </WalletProviders>
  )
}

function CtaInner({ autoStart }: { autoStart: boolean }) {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { openConnectModal, connectModalOpen } = useConnectModal()
  // Route to /score only for a connection initiated from this button — never
  // auto-redirect a visitor who merely arrives connected or connects via the
  // header. Cleared if the modal is dismissed without connecting.
  const pending = useRef(false)
  const modalWasOpen = useRef(false)
  const started = useRef(false)

  // The island mounted because the visitor clicked "Calculate Score" — honor
  // that click as soon as the modal can open, or immediately if a persisted
  // session already reconnected.
  useEffect(() => {
    if (!autoStart || started.current) return
    if (isConnected) {
      started.current = true
      router.push(inputPath())
      return
    }
    if (openConnectModal) {
      started.current = true
      pending.current = true
      openConnectModal()
    }
  }, [autoStart, isConnected, openConnectModal, router])

  useEffect(() => {
    if (connectModalOpen) modalWasOpen.current = true
    if (pending.current && isConnected) {
      pending.current = false
      router.push(inputPath())
    } else if (pending.current && modalWasOpen.current && !connectModalOpen && !isConnected) {
      // Modal closed without a connection: cancel the pending redirect. If the
      // close event races ahead of the connect event, the user simply stays on
      // the landing page, already connected — clicking again proceeds.
      pending.current = false
    }
  }, [connectModalOpen, isConnected, router])

  function handleClick() {
    if (isConnected) {
      router.push(inputPath())
      return
    }
    pending.current = true
    openConnectModal?.()
  }

  return <Button onClick={handleClick}>Calculate Score</Button>
}
