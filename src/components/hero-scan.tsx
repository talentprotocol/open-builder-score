'use client'

import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'
import { ScoreCountUp } from '@/components/motion/score-count-up'

const ROWS = ['6 chains', 'GitHub', 'SpeedRun Ethereum', 'EAS attestations']

// Self-running scan loop for the landing hero: four sources settle, a score
// counts up, hold, repeat. Pure presentation — fetches nothing. Steps 1–4
// settle the rows, 5–7 hold the score, then the loop resets.
export function HeroScan() {
  const reduced = useReducedMotion()
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setStep((s) => (s + 1) % 8), 800)
    return () => clearInterval(id)
  }, [reduced])

  const effective = reduced ? 7 : step

  return (
    <div
      aria-hidden
      className="blueprint-grid relative w-full max-w-xs shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/60 p-5 font-mono"
    >
      <SweepOverlay />
      <ul className="flex flex-col gap-2.5 text-xs">
        {ROWS.map((row, i) => (
          <li
            key={row}
            className={`flex items-center gap-2 ${effective > i ? 'text-emerald-400' : 'text-zinc-600'}`}
          >
            <PingDot settled={effective > i} />
            {row}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex h-9 items-baseline gap-1.5">
        {effective >= 5 ? (
          <>
            <ScoreCountUp value={141} className="text-3xl font-bold text-zinc-50" />
            <span className="text-xs text-zinc-600">/ 257</span>
          </>
        ) : (
          <span className="text-[10px] tracking-[0.18em] text-emerald-400/70">SCANNING…</span>
        )}
      </div>
    </div>
  )
}
