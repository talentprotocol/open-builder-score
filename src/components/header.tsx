'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { TalentWordmark } from '@/components/brand/talent-wordmark'
import { Button } from '@/components/ui/button'
import { useHasWalletSession } from '@/lib/wallet'

const HeaderConnect = dynamic(() => import('@/components/wallet/header-connect'), {
  ssr: false,
  loading: () => (
    <Button disabled aria-busy>
      Connect Wallet
    </Button>
  ),
})

export function Header() {
  // The wallet island (and with it the whole wagmi/RainbowKit stack) mounts
  // only when the visitor clicks Connect — then the modal opens — or when a
  // persisted wagmi session exists, mounting silently to restore the chip.
  const [clicked, setClicked] = useState(false)
  const session = useHasWalletSession()

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-12 w-full max-w-3xl items-center justify-between px-4">
        <Link href="/" aria-label="talent — home" className="flex items-center gap-2.5">
          {/* Same lockup as the talent.app navbar (TalentProtocolLogo there is
              this exact SVG): the t glyph with the talent word, no app name. */}
          <TalentWordmark className="h-4 w-auto" />
        </Link>
        {clicked || session ? (
          <HeaderConnect autoOpen={clicked} />
        ) : (
          <Button onClick={() => setClicked(true)}>Connect Wallet</Button>
        )}
      </div>
    </header>
  )
}
