'use client'

import { motion } from 'motion/react'

// Checklist dot: hollow while pending; success fill plus one expanding ring
// when `settled` flips true. All information is also carried by the row's
// text color, so the ping is purely additive. Color lives in CSS classes so
// it theme-switches; Motion only drives the ring.
export function PingDot({ settled }: { settled: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-none">
      <span
        className={`absolute inset-0 rounded-full border transition-colors duration-200 ${
          settled ? 'border-success bg-success' : 'border-ring bg-transparent'
        }`}
      />
      {settled && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-success"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 3 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
    </span>
  )
}
