'use client'

import { useState } from 'react'

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (permissions/insecure context): quietly do nothing.
    }
  }

  return (
    <button onClick={handleCopy} className="text-sm text-zinc-400 underline">
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}
