'use client'

import { motion, useReducedMotion } from 'motion/react'

// Radar sweep looping down the parent (parent must be relative +
// overflow-hidden). Pure decoration — hidden from AT and reduced motion.
export function SweepOverlay() {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 h-20 border-b border-emerald-400/50 bg-gradient-to-b from-transparent to-emerald-400/10"
      initial={{ top: '-25%' }}
      animate={{ top: '110%' }}
      transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
    />
  )
}
