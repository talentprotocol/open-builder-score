'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { inputPath } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { useHasWalletSession } from '@/lib/wallet'

const LandingCtaWallet = dynamic(() => import('@/components/wallet/landing-cta-island'), {
  ssr: false,
  loading: () => (
    <Button disabled aria-busy>
      Check your score
    </Button>
  ),
})

export function LandingCta() {
  // Same gate as the header: the wallet stack loads only for a visitor who
  // clicks (the connect flow then starts itself) or who arrives with a
  // persisted session (a click then routes straight to the form).
  const [clicked, setClicked] = useState(false)
  const session = useHasWalletSession()

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      {clicked || session ? (
        <LandingCtaWallet autoStart={clicked} />
      ) : (
        <Button onClick={() => setClicked(true)}>Check your score</Button>
      )}
      <Link
        href={inputPath()}
        className="text-base text-muted-foreground underline transition-colors hover:text-foreground"
      >
        or check any address
      </Link>
    </div>
  )
}
