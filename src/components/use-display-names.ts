'use client'

import { useEffect, useState } from 'react'
import { resolveDisplayNames } from '@/lib/names'

// Resolves basenames/ENS for a set of addresses, keyed by lowercased address.
// Rows render immediately with raw addresses; names swap in when they land.
export function useDisplayNames(addresses: readonly string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  const key = addresses
    .map((a) => a.toLowerCase())
    .sort()
    .join(',')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    resolveDisplayNames(key.split(',')).then((resolved) => {
      if (cancelled || resolved.size === 0) return
      setNames(Object.fromEntries(resolved))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return names
}
