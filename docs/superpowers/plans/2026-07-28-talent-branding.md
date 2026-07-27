# Talent Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin Open Builder Score to Talent Protocol's brand (tokens, typography, theming, component idioms, logo) while preserving the signal-scan motion language byte-identical in behavior.

**Architecture:** Port Talent's CSS-variable token system into `globals.css` (light `:root` gray scale / dark `.dark` neutral scale), add next-themes class-strategy theming with dark default, route the four hardcoded emerald literals through new `--signal` tokens, then re-skin each screen/component to Talent idioms using a class-mapping table. Two tiny hand-written primitives (Button, Badge) and two vendored inline-SVG brand components. No monorepo dependency.

**Tech Stack:** Next.js 16.2.11 (App Router, custom build — read `node_modules/next/dist/docs/` before writing Next-specific code per AGENTS.md), Tailwind CSS v4 (CSS-first, no tailwind.config), Motion ^12 (`motion/react`), next-themes ^0.4.6 (new), @phosphor-icons/react ^2.1.10 (new), RainbowKit ^2.2.11.

**Spec:** `docs/superpowers/specs/2026-07-27-talent-branding-design.md`

## Global Constraints

- All work on branch `feat/talent-branding`. Commit at the end of every task.
- **No motion behavior changes.** Springs, delays, durations, choreography, reduced-motion guards stay exactly as they are. Only colors/classes on motion components change.
- **Emerald only with meaning:** scan motifs (grid, sweep, ping, earned flash, SCANNING captions), earned/verified/success states, attestation-success links. All other chrome is monochrome tokens. Never `emerald-*` literals — always `success`/`--signal` tokens.
- **Type scale remap is per-occurrence, not find-replace.** The new scale shrinks every `text-*` step. Remap to preserve current pixel sizes:

  | Old class (px today) | New class (same px) |
  |---|---|
  | `text-[10px] tracking-[0.18em]` (10) | `text-xs tracking-[0.18em]` |
  | `text-xs` (12) | `text-sm` |
  | `text-sm` (14) | `text-base` |
  | `text-lg` (18) | `text-lg` (unchanged px) + `font-heading font-normal` on headings |
  | `text-2xl` (24, page h1) | `text-xl font-heading font-normal` |
  | `text-3xl` (30, hero-scan number) | `text-xl` (24 — closest step) |
  | `text-4xl` (36, landing h1) | `text-2xl font-heading font-normal` |
  | `text-5xl` (48, score number) | `text-3xl` (48) |

- **Color class mapping (apply everywhere; exact old → new):**

  | Old | New |
  |---|---|
  | `border-zinc-800`, `border-zinc-700` | `border-border` |
  | `bg-zinc-950/60` (hero panel) | `bg-card/50` |
  | `bg-zinc-900/40` (not_earned card) | `bg-card` |
  | `text-zinc-300` | `text-foreground` |
  | `text-zinc-400`, `text-zinc-500` | `text-muted-foreground` |
  | `text-zinc-600` (dim/pending) | `text-muted-foreground/70` |
  | `text-zinc-200`, `text-zinc-50` | `text-foreground` |
  | `text-emerald-400`, `text-emerald-500` (semantic: verified/earned/scan) | `text-success` |
  | `border-emerald-500/40 bg-emerald-500/5` (earned card) | `border-success/30 bg-success/10` |
  | `border-emerald-700 bg-emerald-950/40` (match banner) | `border-success/30 bg-success/10` |
  | `bg-emerald-600 … hover:bg-emerald-500` (buttons) | `<Button variant="primary">` (inverted monochrome) |
  | `text-amber-500` | `text-warning` |
  | `border-amber-500/40 bg-amber-500/5` / `border-amber-700 bg-amber-950/40` | `border-warning/30 bg-warning/10` |
  | `text-red-400` | `text-destructive` |
  | `border-zinc-600` (PingDot pending) | `border-ring` |
  | `emerald-400/50`, `emerald-400/10` (sweep) | `success/50`, `success/10` |
  | plain-navigation emerald links (`Try again`, `← Verify another`, `← Back`) | `text-muted-foreground underline hover:text-foreground` |
  | attestation-success links (easscan, `Verify it here`, history `Verify →`, AttestationDetails wallet/easscan links) | `text-success underline` (keep) |

- **Radii:** panels/cards `rounded-lg` (10px under new `--radius`), buttons/inputs `rounded-md` (8px), badges `rounded-sm` (6px), dots `rounded-full`.
- Gates for every task: `npm run typecheck && npm run build` must pass. `npm run test` (78 tests) must stay green — it's lib-level; if it breaks, the task did something wrong.
- Reference sources (read-only, never imported): `~/Documents/workspace/talentprotocol/talent-apps/packages/tailwind-config/shared-styles.css`, `packages/ui/src/components/ui/button.tsx`, `packages/ui/src/logos/TalentProtocol{Icon,Logo}.tsx`.

---

### Task 1: Dependencies, token layer, fonts, theme plumbing

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/app/globals.css` (full rewrite below)
- Modify: `src/app/layout.tsx`
- Modify: `src/app/providers.tsx`

**Interfaces:**
- Produces: semantic Tailwind utilities (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, `text-success`, `text-warning`, `text-destructive`, `border-input`, `ring-ring`, `text-accent-foreground`, `bg-accent`), `font-heading` utility, CSS vars `--signal`, `--grid-line`, `--signal-glow`, `--signal-flash`, dark mode via `.dark` class, fonts Cal Sans/Geist/Geist Mono. Later tasks rely on ALL of these.
- Consumes: nothing.

- [ ] **Step 1: Install dependencies**

```bash
npm install next-themes@^0.4.6 @phosphor-icons/react@^2.1.10
```

- [ ] **Step 2: Rewrite `src/app/globals.css`** with exactly:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  /* Font families (Talent: Geist body, Geist Mono metrics, Cal Sans headings) */
  --font-sans: var(--font-geist-sans, "Geist", system-ui, sans-serif);
  --font-mono: var(--font-geist-mono, "Geist Mono", monospace);
  --font-heading: var(--font-cal-sans, "Cal Sans", sans-serif);

  /* Talent type scale — 14px body base */
  --text-xs: 0.625rem; /* 10px */
  --text-xs--line-height: 0.9375rem;
  --text-sm: 0.75rem; /* 12px */
  --text-sm--line-height: 1.125rem;
  --text-base: 0.875rem; /* 14px */
  --text-base--line-height: 1.3125rem;
  --text-md: 1rem; /* 16px */
  --text-md--line-height: 1.5rem;
  --text-lg: 1.125rem; /* 18px */
  --text-lg--line-height: 1.35rem;
  --text-xl: 1.5rem; /* 24px */
  --text-xl--line-height: 1.8rem;
  --text-2xl: 2.25rem; /* 36px */
  --text-2xl--line-height: 2.7rem;
  --text-3xl: 3rem; /* 48px */
  --text-3xl--line-height: 3.6rem;

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  color-scheme: light;
  --radius: 0.625rem;
  /* Light Mode - Gray (Talent) */
  --background: theme(colors.gray.50);
  --foreground: theme(colors.gray.950);
  --card: theme(colors.white);
  --card-foreground: theme(colors.gray.950);
  --popover: theme(colors.white);
  --popover-foreground: theme(colors.gray.950);
  --primary: theme(colors.gray.950);
  --primary-foreground: theme(colors.gray.50);
  --secondary: theme(colors.gray.200);
  --secondary-foreground: theme(colors.gray.950);
  --muted: theme(colors.white);
  --muted-foreground: theme(colors.gray.600);
  --accent: theme(colors.gray.100);
  --accent-foreground: theme(colors.gray.900);
  --destructive: theme(colors.red.500);
  --destructive-foreground: theme(colors.white);
  --warning: theme(colors.amber.500);
  --warning-foreground: theme(colors.white);
  --success: theme(colors.emerald.500);
  --success-foreground: theme(colors.white);
  --border: theme(colors.gray.200);
  --input: theme(colors.gray.200);
  --ring: theme(colors.gray.400);

  /* Signal tokens (app-specific): emerald carries meaning only.
     Alphas are per-theme; light needs more presence on gray-50. */
  --signal: var(--success);
  --grid-line: color-mix(in oklab, var(--signal) 8%, transparent);
  --signal-glow: color-mix(in oklab, var(--signal) 15%, transparent);
  --signal-flash: color-mix(in oklab, var(--signal) 55%, transparent);
}

.dark {
  color-scheme: dark;
  /* Dark Mode - Neutral (Talent) */
  --background: theme(colors.neutral.950);
  --foreground: theme(colors.neutral.50);
  --card: theme(colors.neutral.900);
  --card-foreground: theme(colors.neutral.50);
  --popover: theme(colors.neutral.900);
  --popover-foreground: theme(colors.neutral.50);
  --primary: theme(colors.neutral.50);
  --primary-foreground: theme(colors.neutral.950);
  --secondary: theme(colors.neutral.800);
  --secondary-foreground: theme(colors.neutral.50);
  --muted: theme(colors.neutral.900);
  --muted-foreground: theme(colors.neutral.500);
  --accent: theme(colors.neutral.800);
  --accent-foreground: theme(colors.neutral.50);
  --destructive: theme(colors.red.600);
  --destructive-foreground: theme(colors.neutral.50);
  --warning: theme(colors.amber.500);
  --warning-foreground: theme(colors.neutral.50);
  --success: theme(colors.emerald.500);
  --success-foreground: theme(colors.neutral.50);
  --border: theme(colors.neutral.800);
  --input: theme(colors.neutral.800);
  --ring: theme(colors.neutral.600);

  --grid-line: color-mix(in oklab, var(--signal) 6%, transparent);
}

@layer base {
  * {
    border-color: var(--border);
    outline-color: var(--ring);
  }

  /* Instant theme switches — no crossfade (Talent convention) */
  .theme-transitioning *,
  .theme-transitioning *::before,
  .theme-transitioning *::after {
    transition: none !important;
  }

  body {
    background-color: var(--background);
    color: var(--foreground);
  }

  a,
  button {
    cursor: pointer;
  }

  *:focus {
    outline: none;
  }

  *:focus-visible {
    outline: none;
  }

  a:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 50%, transparent);
    border-radius: calc(var(--radius) - 2px);
  }
}

@utility font-heading {
  font-family: var(--font-heading);
}

.blueprint-grid {
  background-image: linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 22px 22px;
}
```

Note: the old `body { font-family: Arial… }` rule is gone deliberately — Tailwind v4 preflight applies `--font-sans` (now Geist) to the document. This fixes the Arial bug.

- [ ] **Step 3: Update `src/app/layout.tsx`** — add Cal Sans, `suppressHydrationWarning` (required by next-themes), Talent attribution in metadata:

```tsx
import type { Metadata } from "next";
import { Cal_Sans, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const calSans = Cal_Sans({
  variable: "--font-cal-sans",
  weight: "400",
  subsets: ["latin"],
  adjustFontFallback: false,
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Builder Score",
  description:
    "A self-scoring page: enter a wallet and get an explainable Builder Score computed entirely in your browser from public data. Built by Talent Protocol.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${calSans.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col blueprint-grid">
        <Providers>
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Update `src/app/providers.tsx`** — add next-themes provider (dark default, system enabled) and theme-synced RainbowKit:

```tsx
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
  // undefined on the server and first client render → dark, matching defaultTheme.
  const { resolvedTheme } = useTheme()
  return (
    <RainbowKitProvider theme={resolvedTheme === 'light' ? RAINBOWKIT_LIGHT : RAINBOWKIT_DARK}>
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
```

- [ ] **Step 5: Verify gates**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass. Build failure here almost certainly means a `globals.css` syntax issue (check `theme()` calls and `@custom-variant` placement).

- [ ] **Step 6: Visual smoke check**

Run `npm run dev`, open `http://localhost:3000`. Expected: dark page (near-black neutral-950), body text now Geist (not Arial), blueprint grid faintly emerald. Components still show old zinc/emerald styling — that's expected until later tasks.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/globals.css src/app/layout.tsx src/app/providers.tsx
git commit -m "feat: Talent token layer, fonts, and next-themes theming"
```

---

### Task 2: UI primitives, brand components, app icon

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/brand/talent-icon.tsx`
- Create: `src/components/brand/talent-wordmark.tsx`
- Create: `src/app/icon.png` (copied from talent-apps)
- Delete: `src/app/favicon.ico`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: `Button({ variant?: 'primary'|'secondary'|'ghost'|'success-secondary', size?: 'default'|'sm'|'icon', ...button props })`; `Badge({ variant?: 'neutral'|'success'|'warning', compact?: boolean, ...span props })`; `TalentIcon({ className? })`; `TalentWordmark({ className? })`. All later tasks use these exact names/props.

- [ ] **Step 1: Create `src/components/ui/button.tsx`** (Talent's exact class recipes, minus the `ui:` prefix, no cva):

```tsx
import type { ButtonHTMLAttributes } from 'react'

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-base font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50'

const variants = {
  primary: 'border-transparent bg-foreground text-background hover:bg-foreground/90',
  secondary: 'border-border bg-accent/40 hover:bg-accent hover:border-foreground/20',
  ghost: 'border-transparent hover:bg-accent hover:text-accent-foreground',
  'success-secondary':
    'border-success/30 bg-success/10 text-success hover:bg-success/20 hover:border-success/50',
} as const

const sizes = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3',
  icon: 'size-9',
} as const

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export function Button({
  variant = 'primary',
  size = 'default',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]}${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}
```

- [ ] **Step 2: Create `src/components/ui/badge.tsx`**:

```tsx
import type { HTMLAttributes } from 'react'

const variants = {
  neutral: 'border-border bg-accent/40 text-foreground',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
} as const

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants
  compact?: boolean
}

export function Badge({ variant = 'neutral', compact = false, className, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-sm border px-2 py-0.5 ${
        compact ? 'text-xs uppercase tracking-wide' : 'text-base'
      } ${variants[variant]}${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}
```

- [ ] **Step 3: Create `src/components/brand/talent-icon.tsx`** — the double-L mark, path data copied verbatim from `talent-apps/packages/ui/src/logos/TalentProtocolIcon.tsx`, rendered in currentColor:

```tsx
export function TalentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 103 216"
      preserveAspectRatio="xMidYMid meet"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path d="M11.1245 90.8628C15.4526 95.1782 21.2234 97.3359 28.4368 97.3359L102.213 97.3359L93.9037 73.6013H35.1694C30.6811 73.6013 28.4368 71.2038 28.4368 66.409L28.4368 8.01778L4.87281 0L4.8728 73.6013C4.8728 80.7936 6.95672 86.5474 11.1245 90.8628Z" />
      <path d="M11.1245 209.527C15.4526 213.842 21.2234 216 28.4368 216H102.213L93.9037 192.265H35.1694C30.6811 192.265 28.4368 189.868 28.4368 185.073L28.4368 126.682L4.87281 118.664L4.8728 192.265C4.8728 199.458 6.95672 205.212 11.1245 209.527Z" />
    </svg>
  )
}
```

- [ ] **Step 4: Create `src/components/brand/talent-wordmark.tsx`** — lowercase "talent" wordmark. Copy ALL SEVEN `<path d="…">` elements verbatim from `talent-apps/packages/ui/src/logos/TalentProtocolLogo.tsx` (viewBox `0 0 330 90`), dropping each `fill={color}` prop so paths inherit the svg's `fill="currentColor"`:

```tsx
export function TalentWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 330 90"
      preserveAspectRatio="xMidYMid meet"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="talent"
    >
      {/* 7 paths from TalentProtocolLogo.tsx go here, verbatim, without fill props */}
    </svg>
  )
}
```

- [ ] **Step 5: Replace the favicon with the Talent icon**

```bash
cp ~/Documents/workspace/talentprotocol/talent-apps/apps/talent-app/public/icon.png src/app/icon.png
git rm src/app/favicon.ico
```

(`src/app/icon.png` is the app-icon file convention in this Next version — it generates the `<link rel="icon">` tag; the stock `favicon.ico` must be removed or it wins for `/favicon.ico`.)

- [ ] **Step 6: Verify gates**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all pass (new components are unreferenced so far — that's fine).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui src/components/brand src/app/icon.png
git commit -m "feat: Talent UI primitives, brand marks, and app icon"
```

(The `git rm` in Step 5 already staged the favicon deletion.)

---

### Task 3: Ping dot and sweep overlay re-plumb (signal tokens)

**Files:**
- Modify: `src/components/motion/ping-dot.tsx`
- Modify: `src/components/motion/sweep-overlay.tsx`

**Interfaces:**
- Consumes: Task 1 tokens (`border-ring`, `bg-success`, `border-success`, `success/50`, `success/10`).
- Produces: same public APIs, unchanged: `PingDot({ settled: boolean })`, `SweepOverlay()`.

- [ ] **Step 1: Rewrite `src/components/motion/ping-dot.tsx`** — move the settled color out of Motion interpolation (literal `#34d399`) into a CSS class flip with `transition-colors`; Motion keeps the ring. Ping choreography (one ring, 0.7s, scale 1→3, opacity 0.9→0) unchanged:

```tsx
'use client'

import { motion } from 'motion/react'

// Checklist dot: hollow while pending; success fill plus one expanding ring
// when `settled` flips true. All information is also carried by the row's
// text color, so the ping is purely additive. Color lives in CSS classes so
// it theme-switches; Motion only drives the ring.
export function PingDot({ settled }: { settled: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-none">
      <span
        className={`absolute inset-0 rounded-full border transition-colors duration-200 ${
          settled ? 'border-success bg-success' : 'border-ring bg-transparent'
        }`}
      />
      {settled && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-success"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 3 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
    </span>
  )
}
```

- [ ] **Step 2: Update `src/components/motion/sweep-overlay.tsx`** — only the two color classes change (`emerald-400` → `success`); timing/behavior identical:

```tsx
'use client'

import { motion, useReducedMotion } from 'motion/react'

// Radar sweep looping down the parent (parent must be relative +
// overflow-hidden). Pure decoration — hidden from AT and reduced motion.
export function SweepOverlay() {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 h-20 border-b border-success/50 bg-gradient-to-b from-transparent to-success/10"
      initial={{ top: '-25%' }}
      animate={{ top: '110%' }}
      transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
    />
  )
}
```

- [ ] **Step 3: Verify gates + visual**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. In `npm run dev`, header dot still pings emerald once on load; landing hero-scan dots settle emerald with expanding rings.

- [ ] **Step 4: Commit**

```bash
git add src/components/motion/ping-dot.tsx src/components/motion/sweep-overlay.tsx
git commit -m "feat: route ping dot and sweep colors through signal tokens"
```

---

### Task 4: Header and footer chrome

**Files:**
- Create: `src/components/theme-toggle.tsx`
- Modify: `src/components/header.tsx`
- Modify: `src/components/footer.tsx`

**Interfaces:**
- Consumes: `Button` (Task 2), `TalentIcon`, `TalentWordmark` (Task 2), `PingDot` (Task 3), next-themes (Task 1).
- Produces: `ThemeToggle()` (no props); `Header()`/`Footer()` unchanged signatures.

- [ ] **Step 1: Create `src/components/theme-toggle.tsx`** — Talent's cycle dark → light → system, Phosphor icons, icon shows the NEXT theme:

```tsx
'use client'

import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react/dist/ssr'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Cycle dark -> light -> system; icon previews the next stop.
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
  const Icon = !mounted
    ? MoonIcon
    : theme === 'dark'
      ? SunIcon
      : theme === 'light'
        ? MonitorIcon
        : MoonIcon

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground"
      aria-label="Toggle theme"
      onClick={() => {
        if (mounted) setTheme(next)
      }}
    >
      <Icon className="size-5" />
    </Button>
  )
}
```

- [ ] **Step 2: Rewrite `src/components/header.tsx`** — h-12 Talent bar, co-branded: Talent mark + wordmark text + PingDot status atom:

```tsx
'use client'

import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { TalentIcon } from '@/components/brand/talent-icon'
import { PingDot } from '@/components/motion/ping-dot'

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-12 w-full max-w-3xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 text-base font-medium tracking-tight">
          <TalentIcon className="h-5 w-auto" />
          Open Builder Score
          <PingDot settled />
        </Link>
        <ConnectButton showBalance={false} chainStatus="none" />
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Rewrite `src/components/footer.tsx`** — Talent single-row idiom: ThemeToggle left with the transparency line; right links at `opacity-50 hover:opacity-100` with ArrowUpRight on externals; wordmark links to talentprotocol.com:

```tsx
import Link from 'next/link'
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr'
import specJson from '../../spec/spec.json'
import { ATTEST_SCHEMA_UID, EASSCAN_SITE } from '@/lib/eas'
import { verifyPath } from '@/lib/routes'
import type { Spec } from '@/lib/types'
import { TalentWordmark } from '@/components/brand/talent-wordmark'
import { ThemeToggle } from '@/components/theme-toggle'

const spec = specJson as Spec

const SCHEMA_URL = `${EASSCAN_SITE}/schema/view/${ATTEST_SCHEMA_UID}`

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">
            Computed entirely in your browser from public data. No backend. · spec v{spec.version}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={verifyPath()}
            className="text-base opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            Verify
          </Link>
          <a
            href={SCHEMA_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-base opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            EAS schema <ArrowUpRightIcon className="size-3" />
          </a>
          <a
            href="https://www.talentprotocol.com"
            target="_blank"
            rel="noreferrer"
            aria-label="Talent Protocol"
            className="opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <TalentWordmark className="h-4 w-auto" />
          </a>
        </div>
      </div>
    </footer>
  )
}
```

- [ ] **Step 4: Verify gates + visual**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. In dev: header shows Talent mark + name + pinging dot; footer shows theme toggle — clicking cycles dark → light → system, whole app re-themes instantly, RainbowKit connect button follows.

- [ ] **Step 5: Commit**

```bash
git add src/components/theme-toggle.tsx src/components/header.tsx src/components/footer.tsx
git commit -m "feat: co-branded Talent header and footer with theme toggle"
```

---

### Task 5: Landing page re-skin

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/hero-scan.tsx`
- Modify: `src/components/landing-cta.tsx`

**Interfaces:**
- Consumes: `Button` (Task 2), tokens (Task 1), re-plumbed motifs (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Update `src/app/page.tsx`** classes (structure, copy, and motion untouched):
  - h1: `text-4xl font-bold tracking-tight` → `font-heading text-2xl font-normal tracking-tight`
  - hero paragraph: `text-zinc-400` → `text-muted-foreground` (14px body stays: no size class = text-base = 14px… it currently has none, keep none)
  - value-prop cards: `rounded-lg border border-zinc-800 p-4` → `rounded-lg border bg-card p-4 shadow-xs dark:bg-card/50`
  - card h2: `text-sm font-medium` → `text-base font-medium`
  - card body: `mt-2 text-xs text-zinc-400` → `mt-2 text-sm text-muted-foreground`
  - "How it works" h2: `text-lg font-semibold` → `font-heading text-lg font-normal`
  - step rows: `text-sm text-zinc-300` → `text-base text-foreground`
  - step numbers: `font-mono text-xs text-emerald-500` → `font-mono text-sm text-muted-foreground` (chrome, not signal)

- [ ] **Step 2: Update `src/components/hero-scan.tsx`** classes (loop logic, timings, aria-hidden untouched):
  - panel: `…rounded-lg border border-zinc-800 bg-zinc-950/60 p-5 font-mono` → `…rounded-lg border bg-card/50 p-5 font-mono shadow-xs` (keep `blueprint-grid relative w-full max-w-xs shrink-0 overflow-hidden`)
  - rows list: `text-xs` → `text-sm`
  - row state: `text-emerald-400` / `text-zinc-600` → `text-success` / `text-muted-foreground/70`
  - count-up: `text-3xl font-bold text-zinc-50` → `text-xl font-bold text-foreground`
  - `/ 257`: `text-xs text-zinc-600` → `text-sm text-muted-foreground/70`
  - SCANNING…: `text-[10px] tracking-[0.18em] text-emerald-400/70` → `text-xs tracking-[0.18em] text-success/70`

- [ ] **Step 3: Update `src/components/landing-cta.tsx`** — primary CTA becomes the inverted monochrome Button (glow dies per spec §3); secondary link to muted:

Replace the `<button …>` with:

```tsx
import { Button } from '@/components/ui/button'
// …
<Button onClick={handleClick} size="default">
  Check your score
</Button>
```

and the link className: `text-sm text-zinc-400 underline` → `text-base text-muted-foreground underline transition-colors hover:text-foreground`.

- [ ] **Step 4: Verify gates + visual**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. Dev: landing h1 in Cal Sans; CTA is black-on-white (light) / white-on-black (dark); hero scan panel emerald motifs on neutral card; both themes look coherent.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/hero-scan.tsx src/components/landing-cta.tsx
git commit -m "feat: landing page on Talent tokens and idioms"
```

---

### Task 6: Score form re-skin

**Files:**
- Modify: `src/app/score/page.tsx`
- Modify: `src/components/github-sign-in.tsx`

**Interfaces:**
- Consumes: `Button` (Task 2), tokens; `--signal-glow` var (Task 1).
- Produces: the shared scan-console input class string (reused verbatim in Task 8):

```
w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-base transition-shadow focus:outline-none focus:ring-1 focus:ring-success/60 focus:shadow-[0_0_18px_var(--signal-glow)]
```

- [ ] **Step 1: Update `src/app/score/page.tsx`** (all form logic, AnimatePresence, SPRING_SOFT untouched):
  - h1: `text-2xl font-semibold` → `font-heading text-xl font-normal`
  - header p: `text-sm text-zinc-400` → `text-base text-muted-foreground`
  - all 3 input labels: `text-xs font-medium text-zinc-400` → `text-sm font-medium text-muted-foreground`
  - `(optional)`: `font-normal text-zinc-600` → `font-normal text-muted-foreground/70`
  - all 3 inputs (primary wallet, extra wallets, github): replace the full className with the scan-console string above (this keeps the signal focus glow — the one deliberate exception per spec §3; `flex-1` stays on the extra-wallet input in place of `w-full`)
  - remove-wallet ✕ button: `rounded-md border border-zinc-700 px-3 text-sm text-zinc-400` → `rounded-md border border-border px-3 text-base text-muted-foreground transition-colors hover:bg-accent`; replace the `✕` text glyph with `<XIcon className="size-4" />` from `@phosphor-icons/react/dist/ssr` (add the import) and keep the existing `aria-label`
  - "+ Add another wallet": `text-xs text-zinc-400 underline` → `text-sm text-muted-foreground underline transition-colors hover:text-foreground`
  - submit button: replace `<button type="submit" disabled={resolving} className="rounded-md bg-emerald-600 …">` with `<Button type="submit" disabled={resolving} className="self-start">…</Button>` (import Button; label logic unchanged)
  - error p: `text-sm text-red-400` → `text-base text-destructive`

- [ ] **Step 2: Update `src/components/github-sign-in.tsx`** (AnimatePresence crossfade untouched):
  - signed-in chip becomes the Talent badge idiom (import `Badge` from `@/components/ui/badge`):

```tsx
<p className="flex items-center gap-2 text-sm text-muted-foreground">
  <Badge variant="success" className="text-sm">✓ Signed in as @{auth.login}</Badge>
  <button onClick={() => clearGithubAuth()} className="underline">
    Sign out
  </button>
</p>
```
  - idle/step container: `text-xs text-zinc-400` → `text-sm text-muted-foreground`
  - user code span: `text-zinc-200` → `text-foreground`
  - device link: `text-emerald-400 underline` → `text-success underline` (verification flow = signal)
  - error text: `text-red-400` → `text-destructive`

- [ ] **Step 3: Verify gates + visual**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. Dev `/score`: inputs glow emerald on focus (both themes), monochrome submit button, wallet add/remove rows still spring.

- [ ] **Step 4: Commit**

```bash
git add src/app/score/page.tsx src/components/github-sign-in.tsx
git commit -m "feat: score form on Talent tokens, signal focus glow kept"
```

---

### Task 7: Results page re-skin (scan panel, score reveal, credential cards, attest)

**Files:**
- Modify: `src/app/score/[wallet]/page.tsx`
- Modify: `src/components/credential-card.tsx`
- Modify: `src/components/attest-panel.tsx`
- Modify: `src/components/attestation-history.tsx`
- Modify: `src/components/copy-link-button.tsx`
- Modify: `src/components/score-percentile.tsx`

**Interfaces:**
- Consumes: `Button`, tokens, `--signal-flash` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Update `src/app/score/[wallet]/page.tsx`**:
  - resolving p: `text-sm text-zinc-400` → `text-base text-muted-foreground`
  - scan panel: `blueprint-grid relative overflow-hidden rounded-lg border border-zinc-800 p-6` → `blueprint-grid relative overflow-hidden rounded-lg border bg-card/50 p-6`
  - scan rows ul: `text-sm` → `text-base`; row state `text-emerald-400`/`text-zinc-500` → `text-success`/`text-muted-foreground`
  - SCANNING SOURCES: `font-mono text-[10px] tracking-[0.18em] text-emerald-400/80` → `font-mono text-xs tracking-[0.18em] text-success/80`
  - error panel: `border border-zinc-700` → `border`; message `text-sm text-red-400` → `text-base text-destructive`; "Try again" `text-sm text-emerald-400 underline` → `text-base text-muted-foreground underline hover:text-foreground`; back link `text-sm text-zinc-400` → `text-base text-muted-foreground`
  - COMPUTED IN YOUR BROWSER: `font-mono text-[10px] tracking-[0.18em] text-zinc-600` → `font-mono text-xs tracking-[0.18em] text-muted-foreground/70`
  - score number: `text-5xl font-bold` → `font-mono text-3xl leading-none tracking-tighter font-bold` (Talent metric idiom, 48px)
  - `/ maxTotal` span: `text-zinc-500` → `text-muted-foreground`
  - partial warning span: `text-xs text-amber-500` → `text-sm text-warning`
  - Edit-inputs link: `text-sm text-zinc-400 underline` → `text-base text-muted-foreground underline hover:text-foreground`
  - address lines: `font-mono text-xs text-zinc-500` → `font-mono text-sm text-muted-foreground`; `· verified` span `text-emerald-400` → `text-success`
  - **earned-card flash re-plumb** — replace the `motion.div` boxShadow-keyframes wrapper with a token-driven overlay (choreography identical: flash lands at delay 0.5 after the cascade, fades over 1.2s):

```tsx
<StaggerItem key={result.slug}>
  <div className="relative rounded-lg">
    {result.state === 'earned' && (
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-lg shadow-[0_0_0_1px_var(--signal-flash)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: [1, 0] }}
        transition={{ duration: 1.2, delay: 0.5, ease: 'easeOut' }}
      />
    )}
    <CredentialCard result={result} />
  </div>
</StaggerItem>
```

  - footnote p: `text-xs text-zinc-600` → `text-sm text-muted-foreground/70`

- [ ] **Step 2: Update `src/components/credential-card.tsx`** — Talent status-secondary card states:

```tsx
const stateStyles: Record<CredentialResult['state'], string> = {
  earned: 'border-success/30 bg-success/10',
  not_earned: 'border-border bg-card opacity-70 dark:bg-card/50',
  unavailable: 'border-warning/30 bg-warning/10',
}
```

  - card shell: `rounded-lg border p-4 flex flex-col gap-1` → `rounded-lg border p-4 flex flex-col gap-1 shadow-xs`
  - name h3: `font-medium text-sm` → `font-medium text-base`
  - points span: `font-mono text-sm tabular-nums` → `font-mono text-base tabular-nums tracking-tighter`
  - unavailable p: `text-xs text-amber-500` → `text-sm text-warning`
  - "Not earned" p: `text-xs text-zinc-500` → `text-sm text-muted-foreground`
  - raw-value p: `text-xs text-zinc-400` → `text-sm text-muted-foreground`
  - formula p: `text-xs text-zinc-500 font-mono` → `text-sm text-muted-foreground/80 font-mono`

- [ ] **Step 3: Update `src/components/attest-panel.tsx`**:
  - gate paragraphs: `text-xs text-amber-500` → `text-sm text-warning`; `text-xs text-zinc-500` → `text-sm text-muted-foreground`; inner link `text-emerald-400 underline` → `text-success underline`
  - panel: `rounded-lg border border-zinc-700 p-4` → `rounded-lg border bg-card p-4 shadow-xs dark:bg-card/50`
  - h2: `text-sm font-medium` → `text-base font-medium`
  - body p: `text-xs text-zinc-500` → `text-sm text-muted-foreground`
  - both action buttons (Switch / Attest): replace `<button … className="rounded-md bg-emerald-600 …">` with `<Button …>` (import Button; keep onClick/disabled/busy children incl. PingDot spans exactly)
  - error p: `text-xs text-red-400` → `text-sm text-destructive`
  - success links: `text-xs text-emerald-400 underline` → `text-sm text-success underline` (both)

- [ ] **Step 4: Update `src/components/attestation-history.tsx`**:
  - h2: `text-sm font-medium text-zinc-400` → `text-base font-medium text-muted-foreground`
  - ul: `text-sm` → `text-base`
  - row border: `border-zinc-800` → `border-border`
  - row span states: revoked `text-zinc-600 line-through` → `text-muted-foreground/60 line-through`; normal `text-zinc-300` → `text-foreground`
  - Verify link: `text-xs text-emerald-400 underline` → `text-sm text-success underline`

- [ ] **Step 5: Update `src/components/copy-link-button.tsx`**: className `text-sm text-zinc-400 underline` → `text-base text-muted-foreground underline transition-colors hover:text-foreground` (scale-pulse untouched).

- [ ] **Step 6: Update `src/components/score-percentile.tsx`**: `text-xs text-zinc-500` → `text-sm text-muted-foreground`.

- [ ] **Step 7: Verify gates + visual**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. Dev: score a real wallet — scan panel pings, odometer in mono tracking-tighter, earned cards flash a success ring once, attest panel monochrome buttons. Check both themes.

- [ ] **Step 8: Commit**

```bash
git add "src/app/score/[wallet]/page.tsx" src/components/credential-card.tsx src/components/attest-panel.tsx src/components/attestation-history.tsx src/components/copy-link-button.tsx src/components/score-percentile.tsx
git commit -m "feat: results page on Talent tokens, token-driven earned flash"
```

---

### Task 8: Verify pages re-skin

**Files:**
- Modify: `src/app/verify/page.tsx`
- Modify: `src/app/verify/[uid]/page.tsx`

**Interfaces:**
- Consumes: `Button`, tokens, scan-console input class (Task 6), verdict styling rules (spec §4).
- Produces: nothing new.

- [ ] **Step 1: Update `src/app/verify/page.tsx`**:
  - h1: `text-2xl font-semibold` → `font-heading text-xl font-normal`
  - header p: `text-sm text-zinc-400` → `text-base text-muted-foreground`
  - label: `text-xs font-medium text-zinc-400` → `text-sm font-medium text-muted-foreground`
  - UID input: replace className with the Task 6 scan-console input string (it is a scan console — glow applies)
  - submit: `<button type="submit" className="rounded-md bg-emerald-600 …">Verify</button>` → `<Button type="submit" className="self-start">Verify</Button>`
  - error p: `text-sm text-red-400` → `text-base text-destructive`

- [ ] **Step 2: Update `src/app/verify/[uid]/page.tsx`**:
  - scan panel + rows + step line: same mapping as Task 7 Step 1 (panel `border bg-card/50`, rows `text-base`, `text-success`/`text-muted-foreground`)
  - invalid panel: `border border-zinc-700` → `border`; h1 `text-sm font-medium text-red-400` → `text-base font-medium text-destructive`; problems ul `text-sm text-zinc-300` → `text-base text-foreground`
  - all `← Verify another attestation` links: `text-sm text-emerald-400 underline` → `text-base text-muted-foreground underline hover:text-foreground` (navigation, not signal)
  - not_comparable banners: `border border-amber-700 bg-amber-950/40` → `border border-warning/30 bg-warning/10`; h1 `text-sm font-medium text-amber-500` → `text-base font-medium text-warning`; body `text-xs text-zinc-400` → `text-sm text-muted-foreground`
  - match banner (spring pop untouched): `rounded-lg border border-emerald-700 bg-emerald-950/40 p-4` → `rounded-lg border border-success/30 bg-success/10 p-4`; h1 `text-sm font-medium text-emerald-400` → `text-base font-medium text-success`
  - diverged/incomplete banners: same warning-tint mapping as not_comparable
  - `AttestationDetails` dl: row borders `border-zinc-800` → `border-border`; dt `text-zinc-500` → `text-muted-foreground`; dd values `text-xs` → `text-sm`; wallet + easscan links keep `text-success underline` (attestation context = signal); dl `text-sm` → `text-base`
  - "Recomputed breakdown" h2: `text-sm font-medium text-zinc-400` → `text-base font-medium text-muted-foreground`

- [ ] **Step 3: Verify gates + visual**

Run: `npm run typecheck && npm run test && npm run build`
Expected: pass. Dev: verify a known attestation UID — match banner pops in success tint; a bad UID shows destructive text in a neutral panel.

- [ ] **Step 4: Commit**

```bash
git add src/app/verify
git commit -m "feat: verify pages on Talent tokens with semantic verdict tints"
```

---

### Task 9: Full-app verification pass and light-mode tuning

**Files:**
- Possibly modify: `src/app/globals.css` (only the `--grid-line` / `--signal-glow` percentages)

**Interfaces:** consumes everything; produces the shippable branch.

- [ ] **Step 1: Grep for leftovers** — zero hits expected for brand-rule violations:

```bash
grep -rn "zinc-\|emerald-\|amber-\|red-400\|text-\[10px\]\|rgba(52\|rgba(16," src/ --include="*.tsx" --include="*.css" | grep -v node_modules
```

Expected: no output. Any hit is an unmigrated class — fix it using the Global Constraints tables.

- [ ] **Step 2: Run all gates**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

Expected: all pass, 78 tests green.

- [ ] **Step 3: Browser pass — dark theme (default).** `npm run dev`, walk all 5 screens (`/`, `/score`, `/score/[wallet]` with a real address, `/verify`, `/verify/[uid]`): Geist body / Cal Sans headings / mono metrics; monochrome buttons; emerald only on scan motifs + earned/verified; header mark + ping; footer wordmark; RainbowKit modal dark.

- [ ] **Step 4: Browser pass — light theme.** Toggle via footer. Check specifically: blueprint grid visible-but-quiet on gray-50 (if invisible, raise `:root` `--grid-line` mix toward 10–12%; if garish, lower it — edit only the percentage in `globals.css`); sweep overlay legible on white cards; focus glow visible; success/warning tints readable; RainbowKit modal light. Instant theme flip, no transition artifacts, no hydration warnings in console.

- [ ] **Step 5: Reduced-motion pass.** Enable OS reduce-motion: sweep gone, hero-scan pinned to final state, count-ups instant, no regressions.

- [ ] **Step 6: Commit any tuning + final commit**

```bash
git add -A && git commit -m "feat: light-mode signal tuning and final branding polish"
```

(Skip the commit if Step 1–5 required no changes.)

---

## Self-review notes

- Spec coverage: §1 tokens → Task 1; §2 theming → Tasks 1, 4; §3 signal re-plumb (4 literals) → Task 1 (grid), Task 3 (ping/sweep), Task 6 (focus glow), Task 7 (earned flash), CTA glow removal → Task 5; §4 components table → Tasks 2, 4–8; §5 copy/metadata → Tasks 1 (metadata), 5 (headings; copy already on-voice); favicon → Task 2; §8 verification → per-task gates + Task 9.
- The `theme(colors.…)` function calls in Task 1 CSS are the exact syntax talent-apps uses on the same Tailwind v4 line.
- `text-md` exists in the new scale but no task uses it — reserved, not an error.
