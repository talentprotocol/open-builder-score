'use client'

import { useEffect, useState } from 'react'
import { fetchScorePercentile, type Percentile } from '@/lib/percentile'
import { FadeRise } from '@/components/motion/fade-rise'

// Self-fetching, like AttestationHistory: renders nothing while loading, on
// error, or when no comparable attestation corpus exists yet.
export function ScorePercentile({ score }: { score: number }) {
  const [percentile, setPercentile] = useState<Percentile | null>(null)

  useEffect(() => {
    let cancelled = false
    setPercentile(null)
    ;(async () => {
      const result = await fetchScorePercentile(score)
      if (!cancelled && result.status === 'ok') setPercentile(result.percentile)
    })()
    return () => {
      cancelled = true
    }
  }, [score])

  if (percentile === null) return null
  return (
    <FadeRise>
      <p className="text-sm text-muted-foreground">
        Higher than {percentile.countBelow} of {percentile.corpusSize} attested Builder{' '}
        {percentile.corpusSize === 1 ? 'Score' : 'Scores'} · top {percentile.topPercent}%
        {percentile.truncated && ' · based on the most recent 500'}
      </p>
    </FadeRise>
  )
}
