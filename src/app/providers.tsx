'use client'

import { MotionConfig } from 'motion/react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

// Theme + motion only. The wagmi/RainbowKit/react-query stack lives in
// @/components/wallet/wallet-providers and mounts per wallet island, so the
// root tree — and with it every page's first load — carries none of it.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  )
}
