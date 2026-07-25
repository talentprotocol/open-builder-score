'use client'

import { motion } from 'motion/react'

// Checklist dot: hollow while pending; emerald fill plus one expanding ring
// when `settled` flips true. All information is also carried by the row's
// text color, so the ping is purely additive.
export function PingDot({ settled }: { settled: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-none">
      <motion.span
        className="absolute inset-0 rounded-full border border-zinc-600"
        animate={settled ? { backgroundColor: '#34d399', borderColor: '#34d399' } : {}}
        transition={{ duration: 0.2 }}
      />
      {settled && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-emerald-400"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 3 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
    </span>
  )
}
