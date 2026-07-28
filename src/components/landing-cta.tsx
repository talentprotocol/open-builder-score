'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { inputPath } from '@/lib/routes'
import { Button } from '@/components/ui/button'

export function LandingCta() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { openConnectModal, connectModalOpen } = useConnectModal()
  // Route to /score only for a connection initiated from this button — never
  // auto-redirect a visitor who merely arrives connected or connects via the
  // header. Cleared if the modal is dismissed without connecting.
  const pending = useRef(false)
  const modalWasOpen = useRef(false)

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

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <Button onClick={handleClick}>Check your score</Button>
      <Link
        href={inputPath()}
        className="text-base text-muted-foreground underline transition-colors hover:text-foreground"
      >
        or check any address
      </Link>
    </div>
  )
}
