'use client'

import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export function Header() {
  return (
    <header className="border-b border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Open Builder Score
        </Link>
        <ConnectButton showBalance={false} chainStatus="none" />
      </div>
    </header>
  )
}
