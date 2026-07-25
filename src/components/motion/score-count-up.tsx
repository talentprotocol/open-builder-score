'use client'

import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'

export function ScoreCountUp({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(() => (reduced ? value : 0))

  useEffect(() => {
    if (reduced) {
      setShown(value)
      return
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.2, 0.75, 0.25, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, reduced])

  return <span className={`tabular-nums ${className ?? ''}`}>{shown}</span>
}
