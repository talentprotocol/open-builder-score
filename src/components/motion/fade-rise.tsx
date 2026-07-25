'use client'

import { motion } from 'motion/react'
import { SPRING } from './presets'

export function FadeRise({
  children,
  delay = 0,
  whileInView = false,
  className,
}: {
  children: React.ReactNode
  delay?: number
  whileInView?: boolean
  className?: string
}) {
  const target = { opacity: 1, y: 0 }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      {...(whileInView
        ? { whileInView: target, viewport: { once: true, margin: '-40px' } }
        : { animate: target })}
      transition={{ ...SPRING, delay }}
    >
      {children}
    </motion.div>
  )
}
