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
import { useTheme } from 'next-themes'
import { base } from 'wagmi/chains'
import { useMounted } from '@/components/use-mounted'
import { WALLETCONNECT_PROJECT_ID } from '@/lib/wallet'

// The wagmi/RainbowKit/react-query stack, mounted per wallet island (header
// connect, landing CTA, score-form prefill, attest panel) instead of at the
// root layout — that keeps it out of every page's first-load JS. The config
// and query client are module-scoped, so every island shares one wagmi store:
// connecting in one updates them all.
const config = getDefaultConfig({
  appName: 'Open Builder Score',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [base],
  // Islands mount client-only (next/dynamic, ssr: false), so there is no
  // server pass to keep hydration-consistent with; false lets wagmi restore
  // the persisted connection on first render instead of after a mount effect.
  ssr: false,
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

export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitThemed>{children}</RainbowKitThemed>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
