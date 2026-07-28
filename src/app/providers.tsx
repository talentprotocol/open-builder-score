'use client'

import '@rainbow-me/rainbowkit/styles.css'
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
  lightTheme,
} from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { MotionConfig } from 'motion/react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { base, baseSepolia } from 'wagmi/chains'
import { useMounted } from '@/components/use-mounted'
import { WALLETCONNECT_PROJECT_ID } from '@/lib/wallet'

const config = getDefaultConfig({
  appName: 'Open Builder Score',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [baseSepolia, base],
  ssr: true,
})

const queryClient = new QueryClient()

// Hex values mirror the token layer: gray-950/gray-50 (light), neutral-50/
// neutral-950 (dark). RainbowKit needs literals, not CSS vars.
const RAINBOWKIT_LIGHT = lightTheme({
  accentColor: '#030712',
  accentColorForeground: '#f9fafb',
  borderRadius: 'medium',
})
const RAINBOWKIT_DARK = darkTheme({
  accentColor: '#fafafa',
  accentColorForeground: '#0a0a0a',
  borderRadius: 'medium',
})

function RainbowKitThemed({ children }: { children: React.ReactNode }) {
  // Dark on the server and through the hydration render, matching defaultTheme —
  // a stored light theme would otherwise mismatch RainbowKit's injected style tag.
  const { resolvedTheme } = useTheme()
  const mounted = useMounted()
  return (
    <RainbowKitProvider
      theme={mounted && resolvedTheme === 'light' ? RAINBOWKIT_LIGHT : RAINBOWKIT_DARK}
    >
      {children}
    </RainbowKitProvider>
  )
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitThemed>
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
          </RainbowKitThemed>
        </QueryClientProvider>
      </WagmiProvider>
    </NextThemesProvider>
  )
}
