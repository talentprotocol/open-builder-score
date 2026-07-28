'use client'

import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { TalentIcon } from '@/components/brand/talent-icon'
import { PingDot } from '@/components/motion/ping-dot'

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-12 w-full max-w-3xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 text-base font-medium tracking-tight">
          <TalentIcon className="h-5 w-auto" />
          Open Builder Score
          <PingDot settled />
        </Link>
        <ConnectButton showBalance={false} chainStatus="none" />
      </div>
    </header>
  )
}
