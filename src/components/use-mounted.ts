'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

// True after hydration; false on the server and during the hydration render.
// useSyncExternalStore instead of a setState-in-effect so the lint rule
// stays clean and the component re-renders exactly once post-hydration.
export function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}
