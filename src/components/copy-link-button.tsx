'use client'

import { useState } from 'react'
import { motion } from 'motion/react'

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
    <motion.button
      onClick={handleCopy}
      animate={copied ? { scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.3 }}
      className="text-base text-muted-foreground underline transition-colors hover:text-foreground"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </motion.button>
  )
}
