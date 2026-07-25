'use client'

import { FadeRise } from '@/components/motion/fade-rise'

export default function Template({ children }: { children: React.ReactNode }) {
  return <FadeRise className="flex flex-1 flex-col">{children}</FadeRise>
}
