# Signal Scan UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One coherent "signal scan" motion language across the whole app — animated gather → score reveal as the centerpiece — so the app feels futuristic and self-explanatory.

**Architecture:** A small motion-primitive library (`src/components/motion/`) built on the `motion` package wraps existing presentation; pages keep their state machines and fetchers untouched. The gather checklist becomes a scan panel driven by real `onSourceSettled` events; the score count-ups; cards cascade; landing gets a self-running hero scan; verify gets the same scan + a verdict reveal.

**Tech Stack:** `motion` (Motion for React — imports from `motion/react`), Tailwind v4, existing Next 16 App Router pages.

**Spec:** `docs/superpowers/specs/2026-07-25-signal-scan-ui-design.md` (reference motion sketch: `.superpowers/brainstorm/31070-1784999932/content/visual-direction-v2.html`)

## Global Constraints

- Never add a `webpack:` key to `next.config.ts`; leave `turbopack.ignoreIssue` untouched.
- Exactly ONE new dependency: `motion` (installed in Task 1). Nothing else. Zero secrets, zero env vars.
- Zero logic changes: state machines, fetchers, URLs, and all `src/lib/*` files stay byte-identical. Motion wraps presentation only. (One sanctioned exception: passing the *existing* `onSourceSettled` callback of `gatherInputs` on the verify page, and giving the form's extra-wallet rows stable ids for correct exit animations — neither changes behavior.)
- All 163 existing tests stay green, unmodified. This phase adds no tests (no business logic); verification is typecheck + build + the coordinator's browser pass.
- Motion never lies or delays: pings fire on real settle events; no artificial timeouts around data; partial results keep amber.
- Every animation is transform/opacity/box-shadow only; grid and sweep are CSS gradients. Reduced motion: global `<MotionConfig reducedMotion="user">` + `useReducedMotion()` guards on loops; all states legible with animation off.
- Turbopack JSX gotcha: text wrapping to a new line after an `{expression}` loses its leading space — keep continuation text on the same line or use explicit `{' '}`.
- Visual language: zinc + emerald, amber for warnings; loud effects only during computation.
- Known transient: stale `.next/dev/types` typecheck errors while the dev server runs → `npm run build` once, retry. Never run `npm run dev`.
- Work happens on branch `feat/signal-scan-ui`.

---

### Task 1: Motion foundation

**Files:**
- Modify: `package.json` / lockfile (via `npm install motion`)
- Create: `src/components/motion/presets.ts`, `fade-rise.tsx`, `stagger.tsx`, `score-count-up.tsx`, `ping-dot.tsx`, `sweep-overlay.tsx`
- Modify: `src/app/providers.tsx`, `src/app/globals.css`

**Interfaces (consumed by Tasks 2–6):**
- `SPRING`, `SPRING_SOFT` transition presets.
- `<FadeRise delay? whileInView? className?>` entrance wrapper.
- `<Stagger className?>` / `<StaggerItem className?>` cascade pair.
- `<ScoreCountUp value className?>` springs 0→value, tabular-nums, instant under reduced motion.
- `<PingDot settled />` checklist dot with one expanding ring when `settled` flips true (pings on mount if mounted `settled`).
- `<SweepOverlay />` looping radar line (parent needs `relative overflow-hidden`); returns null under reduced motion.
- `.blueprint-grid` CSS utility; app-wide `<MotionConfig reducedMotion="user">`.

- [ ] **Step 1: Install the dependency**

```bash
npm install motion
```

Expected: `motion` (^12.x) added to `package.json` dependencies.

- [ ] **Step 2: Create the primitives**

Create `src/components/motion/presets.ts`:

```ts
// One physics for the whole app: every entrance, cascade, and reveal uses
// these springs so motion feels like a single instrument.
export const SPRING = { type: 'spring', stiffness: 260, damping: 26 } as const
export const SPRING_SOFT = { type: 'spring', stiffness: 170, damping: 26 } as const
```

Create `src/components/motion/fade-rise.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import { SPRING } from './presets'

export function FadeRise({
  children,
  delay = 0,
  whileInView = false,
  className,
}: {
  children: React.ReactNode
  delay?: number
  whileInView?: boolean
  className?: string
}) {
  const target = { opacity: 1, y: 0 }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      {...(whileInView
        ? { whileInView: target, viewport: { once: true, margin: '-40px' } }
        : { animate: target })}
      transition={{ ...SPRING, delay }}
    >
      {children}
    </motion.div>
  )
}
```

Create `src/components/motion/stagger.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import { SPRING } from './presets'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: SPRING },
}

export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div className={className} variants={container} initial="hidden" animate="show">
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  )
}
```

Create `src/components/motion/score-count-up.tsx`:

```tsx
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
```

Create `src/components/motion/ping-dot.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'

// Checklist dot: hollow while pending; emerald fill plus one expanding ring
// when `settled` flips true. All information is also carried by the row's
// text color, so the ping is purely additive.
export function PingDot({ settled }: { settled: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-none">
      <motion.span
        className="absolute inset-0 rounded-full border border-zinc-600"
        animate={settled ? { backgroundColor: '#34d399', borderColor: '#34d399' } : {}}
        transition={{ duration: 0.2 }}
      />
      {settled && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-emerald-400"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 3 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      )}
    </span>
  )
}
```

Create `src/components/motion/sweep-overlay.tsx`:

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
      className="pointer-events-none absolute inset-x-0 h-20 border-b border-emerald-400/50 bg-gradient-to-b from-transparent to-emerald-400/10"
      initial={{ top: '-25%' }}
      animate={{ top: '110%' }}
      transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
    />
  )
}
```

- [ ] **Step 3: Global config + grid utility**

In `src/app/providers.tsx`: add `import { MotionConfig } from 'motion/react'` and change the innermost provider line to

```tsx
        <RainbowKitProvider>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </RainbowKitProvider>
```

Append to `src/app/globals.css`:

```css
.blueprint-grid {
  background-image: linear-gradient(rgba(52, 211, 153, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(52, 211, 153, 0.04) 1px, transparent 1px);
  background-size: 22px 22px;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 163 tests green. `npm run build` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/motion src/app/providers.tsx src/app/globals.css
git commit -m "feat: motion foundation — primitives, MotionConfig, blueprint grid"
```

---

### Task 2: Gather → score centerpiece (results page)

**Files:**
- Modify: `src/app/score/[wallet]/page.tsx`

**Interfaces:** consumes all Task 1 primitives. Read the file in full first; the state machine, effect, and URLs are untouchable — only render JSX changes.

- [ ] **Step 1: Imports**

Add to the imports:

```tsx
import { motion } from 'motion/react'
import { FadeRise } from '@/components/motion/fade-rise'
import { Stagger, StaggerItem } from '@/components/motion/stagger'
import { ScoreCountUp } from '@/components/motion/score-count-up'
import { PingDot } from '@/components/motion/ping-dot'
import { SweepOverlay } from '@/components/motion/sweep-overlay'
```

- [ ] **Step 2: ENS-resolving row**

Replace the `resolving` render:

```tsx
      {state.phase === 'resolving' && (
        <p className="flex items-center gap-2.5 text-sm text-zinc-400">
          <PingDot settled={false} /> Resolving ENS name…
        </p>
      )}
```

- [ ] **Step 3: The scan panel**

Replace the entire `loading` render block (the current `<ul>`) with:

```tsx
      {state.phase === 'loading' && (
        <div className="blueprint-grid relative overflow-hidden rounded-lg border border-zinc-800 p-6">
          <SweepOverlay />
          <ul className="flex flex-col gap-3 text-sm">
            {SOURCES.map((source) => {
              const done = state.settled.includes(source)
              return (
                <li
                  key={source}
                  className={`flex items-center gap-2.5 ${done ? 'text-emerald-400' : 'text-zinc-500'}`}
                >
                  <PingDot settled={done} />
                  {source === 'chains' && extrasRaw.length > 0
                    ? `Onchain badges & balances (6 chains, ${extrasRaw.length + 1} wallets)`
                    : SOURCE_LABELS[source]}
                </li>
              )
            })}
          </ul>
          <p className="mt-5 font-mono text-[10px] tracking-[0.18em] text-emerald-400/80">
            SCANNING SOURCES
          </p>
        </div>
      )}
```

(The `✓`/`○` glyphs are replaced by `PingDot` + text color; the wallet-count label logic moves verbatim into the new markup.)

- [ ] **Step 4: The reveal**

In the `done` section, make these changes:

a. Wrap the score header `<div className="flex items-center justify-between gap-4">` in `<FadeRise>…</FadeRise>` and, directly above that header inside the section, add the settle caption:

```tsx
          <p className="font-mono text-[10px] tracking-[0.18em] text-zinc-600">
            COMPUTED IN YOUR BROWSER
          </p>
```

b. Replace the plain total `<span className="text-5xl font-bold tabular-nums">{state.scored.score.total}</span>` with:

```tsx
              <ScoreCountUp value={state.scored.score.total} className="text-5xl font-bold" />
```

c. Wrap the address block `<div className="flex flex-col gap-0.5">` in `<FadeRise delay={0.08}>…</FadeRise>`.

d. Replace the credential grid with a cascade — earned cards flash a one-shot emerald edge:

```tsx
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {state.scored.score.perCredential.map((result) => (
              <StaggerItem key={result.slug}>
                <motion.div
                  className="rounded-lg"
                  initial={false}
                  animate={
                    result.state === 'earned'
                      ? {
                          boxShadow: [
                            '0 0 0 1px rgba(52, 211, 153, 0.55)',
                            '0 0 0 1px rgba(52, 211, 153, 0)',
                          ],
                        }
                      : {}
                  }
                  transition={{ duration: 1.2, delay: 0.5, ease: 'easeOut' }}
                >
                  <CredentialCard result={result} />
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
```

e. Wrap the formula footnote `<p className="text-xs text-zinc-600">` in `<FadeRise delay={0.15}>`, `<AttestPanel …/>` in `<FadeRise delay={0.2}>`, and `<AttestationHistory …/>` in `<FadeRise delay={0.25}>`.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 163. `npm run build` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/score/[wallet]/page.tsx'
git commit -m "feat: signal-scan gather panel and score reveal"
```

---

### Task 3: Landing — hero scan + scroll reveals

**Files:**
- Create: `src/components/hero-scan.tsx`
- Modify: `src/app/page.tsx`, `src/components/landing-cta.tsx`

- [ ] **Step 1: Create the hero scan**

Create `src/components/hero-scan.tsx`:

```tsx
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
```

- [ ] **Step 2: Rework the landing sections**

In `src/app/page.tsx`: add

```tsx
import { HeroScan } from '@/components/hero-scan'
import { FadeRise } from '@/components/motion/fade-rise'
```

Restructure the hero section so the copy and the scan sit side by side (scan below on mobile):

```tsx
      <section className="flex flex-col items-start gap-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold tracking-tight">
            A builder score you don&apos;t have to trust.
          </h1>
          <p className="max-w-xl text-zinc-400">
            Open Builder Score computes an explainable Builder Score entirely in your browser from
            public data — then lets you attest it onchain.
          </p>
          <LandingCta />
        </div>
        <HeroScan />
      </section>
```

Wrap the value-props section and the how-it-works section each in `<FadeRise whileInView>…</FadeRise>` (the `FadeRise` replaces nothing — it wraps the existing `<section>` elements' contents; put the wrapper around each `<section>`'s inner markup, keeping the `<section>` tags and their classes on the FadeRise via its `className` prop is also acceptable — pick one and keep the rendered layout identical).

- [ ] **Step 3: CTA glow**

In `src/components/landing-cta.tsx`, extend the button's className to:

```tsx
        className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium transition-shadow hover:bg-emerald-500 hover:shadow-[0_0_24px_rgba(16,185,129,0.35)]"
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` → exit 0. `npm test` → 163. `npm run build` → exit 0.

```bash
git add src/components/hero-scan.tsx src/app/page.tsx src/components/landing-cta.tsx
git commit -m "feat: landing hero scan loop and scroll reveals"
```

---

### Task 4: Input form — entrances, glow, animated wallet rows

**Files:**
- Modify: `src/app/score/page.tsx`, `src/components/github-sign-in.tsx`

Read both files in full first. The form's submit/validation logic is untouchable except for one sanctioned refactor: extra-wallet rows get **stable ids** so exit animations remove the right row.

- [ ] **Step 1: Form page**

In `src/app/score/page.tsx`:

a. Imports:

```tsx
import { AnimatePresence, motion } from 'motion/react'
import { FadeRise } from '@/components/motion/fade-rise'
import { SPRING_SOFT } from '@/components/motion/presets'
```

b. Stable-id refactor — replace the `extraInputs` state and its uses:

```tsx
  const nextRowId = useRef(0)
  const [extraInputs, setExtraInputs] = useState<{ id: number; value: string }[]>(() => {
    const raw = searchParams.get('wallets') ?? ''
    return raw
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w !== '')
      .slice(0, 4)
      .map((value) => ({ id: nextRowId.current++, value }))
  })
```

In `handleSubmit`, `const extras = extraInputs.map((w) => w.value.trim()).filter((w) => w !== '')` (rest of the function unchanged). The add button pushes `{ id: nextRowId.current++, value: '' }`; the remove button filters by `row.id`; the row `onChange` maps by `row.id`.

c. Animated rows — replace the extras `.map(...)` JSX with:

```tsx
      <AnimatePresence initial={false}>
        {extraInputs.map((row, i) => (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING_SOFT}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 pb-0.5">
              <label htmlFor={`wallet-${i + 2}`} className="text-xs font-medium text-zinc-400">
                Wallet {i + 2}
              </label>
              <div className="flex gap-2">
                <input
                  id={`wallet-${i + 2}`}
                  value={row.value}
                  onChange={(e) =>
                    setExtraInputs((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  placeholder="0x… or name.eth"
                  className="flex-1 rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm transition-shadow focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:shadow-[0_0_18px_rgba(16,185,129,0.15)]"
                  spellCheck={false}
                />
                <button
                  type="button"
                  aria-label={`Remove wallet ${i + 2}`}
                  onClick={() => setExtraInputs((prev) => prev.filter((r) => r.id !== row.id))}
                  className="rounded-md border border-zinc-700 px-3 text-sm text-zinc-400"
                >
                  ✕
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
```

d. Give the two primary inputs (`#wallet`, `#github`) the same focus classes appended:
`transition-shadow focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:shadow-[0_0_18px_rgba(16,185,129,0.15)]`

e. In the page component, wrap the `<header>` + `<Suspense>` pair's contents in a `<FadeRise className="flex flex-col gap-8">` (replacing the gap on `<main>` is fine as long as rendered layout is identical).

- [ ] **Step 2: GitHub sign-in transitions**

In `src/components/github-sign-in.tsx`: add `import { AnimatePresence, motion } from 'motion/react'`, then restructure ONLY the return so each visual state cross-fades (all handlers and state logic identical). Shape:

```tsx
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={auth ? 'chip' : ui.step}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18 }}
      >
        {/* existing conditional JSX for auth chip / idle / starting / code / error, unchanged */}
      </motion.div>
    </AnimatePresence>
  )
```

(The two current top-level returns merge into this single wrapper with the same conditionals inside.)

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck` → exit 0. `npm test` → 163. `npm run build` → exit 0.

```bash
git add src/app/score/page.tsx src/components/github-sign-in.tsx
git commit -m "feat: form entrances, focus glow, animated wallet rows"
```

---

### Task 5: Verify flow + small states

**Files:**
- Modify: `src/app/verify/[uid]/page.tsx`, `src/app/verify/page.tsx`, `src/components/attest-panel.tsx`, `src/components/copy-link-button.tsx`, `src/components/score-percentile.tsx`

Read each file before editing. The verify page's classification/verdict logic is untouchable; the ONE sanctioned wiring change is passing `gatherInputs`' existing `onSourceSettled` parameter.

- [ ] **Step 1: Verify UID page — scan during recompute**

In `src/app/verify/[uid]/page.tsx`:

a. Imports: `GatherSource` from `@/lib/orchestrate` (extend the existing import), plus `motion` from `motion/react`, `FadeRise`, `PingDot`, `SweepOverlay`, `SPRING` from the motion components.

b. Extend the loading state to carry settle progress: `{ phase: 'loading'; step: string; settled: GatherSource[] }` — update both `setState({ phase: 'loading', … })` calls to include `settled: []`, and pass the callback in the gather call:

```tsx
        const gather = await gatherInputs(
          classification.decoded.wallet,
          classification.decoded.githubHandle,
          fetchers,
          (source) => {
            if (cancelled) return
            setState((prev) =>
              prev.phase === 'loading'
                ? { ...prev, settled: [...prev.settled, source] }
                : prev,
            )
          },
        )
```

c. Replace the loading render with a compact scan panel (labels local to this file):

```tsx
      {state.phase === 'loading' && (
        <div className="blueprint-grid relative overflow-hidden rounded-lg border border-zinc-800 p-6">
          <SweepOverlay />
          <p className="flex items-center gap-2.5 text-sm text-zinc-400">
            <PingDot settled={false} /> {state.step}
          </p>
          {state.step.startsWith('Recomputing') && (
            <ul className="mt-4 flex flex-col gap-2.5 text-sm">
              {(
                [
                  ['chains', 'Onchain badges & balances (6 chains)'],
                  ['github', 'GitHub'],
                  ['speedrun', 'SpeedRun Ethereum'],
                  ['verifiedBuilder', 'EAS attestations'],
                ] as [GatherSource, string][]
              ).map(([source, label]) => {
                const done = state.settled.includes(source)
                return (
                  <li
                    key={source}
                    className={`flex items-center gap-2.5 ${done ? 'text-emerald-400' : 'text-zinc-500'}`}
                  >
                    <PingDot settled={done} /> {label}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
```

d. Verdict reveal — in the `done` section: wrap the `match` banner div in a scale-spring entrance (replace the plain `<div>` with `<motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING}` keeping its className), and give `diverged` / `incomplete` banners (and the `not_comparable` banner) a `<FadeRise>` wrapper — calmer, no scale. Wrap `<AttestationDetails …/>` in `<FadeRise delay={0.1}>` and the recomputed-breakdown block in `<FadeRise delay={0.15}>` in both the `done` and `not_comparable` sections.

- [ ] **Step 2: Verify input page entrance**

In `src/app/verify/page.tsx`: wrap the main content in `<FadeRise className="flex flex-col gap-8">` (same pattern as the score form page; read the file and keep rendered layout identical).

- [ ] **Step 3: Attest pending + success**

In `src/components/attest-panel.tsx`: add `import { PingDot } from '@/components/motion/ping-dot'` and `import { FadeRise } from '@/components/motion/fade-rise'`. Busy button labels get the scanning motif:

```tsx
            {busy ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Switching…
              </span>
            ) : (
              'Switch to Base Sepolia'
            )}
```

(and the same shape for `Waiting for wallet…` / `Attest onchain`). Wrap the success block `<div className="flex flex-col gap-1">` in `<FadeRise>`.

- [ ] **Step 4: Copy-link pulse + percentile entrance**

`src/components/copy-link-button.tsx`: convert the button to a one-shot pulse on copy:

```tsx
import { motion } from 'motion/react'
…
  return (
    <motion.button
      onClick={handleCopy}
      animate={copied ? { scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.3 }}
      className="text-sm text-zinc-400 underline"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </motion.button>
  )
```

`src/components/score-percentile.tsx`: wrap the rendered `<p>` in `<FadeRise>` (import it; null branches unchanged).

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck` → exit 0. `npm test` → 163. `npm run build` → exit 0.

```bash
git add 'src/app/verify/[uid]/page.tsx' src/app/verify/page.tsx src/components/attest-panel.tsx src/components/copy-link-button.tsx src/components/score-percentile.tsx
git commit -m "feat: verify scan + verdict reveal, pending motifs, small-state motion"
```

---

### Task 6: Global shell — grid, route transitions, header ping

**Files:**
- Create: `src/app/template.tsx`
- Modify: `src/app/layout.tsx`, `src/components/header.tsx`

- [ ] **Step 1: Route transitions**

Create `src/app/template.tsx` (App Router remounts templates per navigation — every route gets the entrance):

```tsx
'use client'

import { FadeRise } from '@/components/motion/fade-rise'

export default function Template({ children }: { children: React.ReactNode }) {
  return <FadeRise className="flex flex-1 flex-col">{children}</FadeRise>
}
```

- [ ] **Step 2: Shell grid**

Read `src/app/layout.tsx`; add the `blueprint-grid` class to the top-level flex wrapper (the element that already carries the min-height flex column classes) so the faint grid sits behind all content. Change nothing else.

- [ ] **Step 3: Header ping**

In `src/components/header.tsx`: add `import { PingDot } from '@/components/motion/ping-dot'` and change the wordmark link content to:

```tsx
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <PingDot settled /> Open Builder Score
        </Link>
```

(`settled` from first mount → one fill + ping on load, then still. Keep the attribute exactly `settled` — it pings once on mount by design.)

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` → exit 0. `npm test` → 163. `npm run build` → exit 0.

```bash
git add src/app/template.tsx src/app/layout.tsx src/components/header.tsx
git commit -m "feat: global blueprint grid, route transitions, header ping"
```

---

## Post-plan validation (coordinator, not a task)

Full browser pass: landing hero scan loops; scroll reveals fire once; input form entrance + focus glow + wallet rows animate in/out correctly (remove the RIGHT row); gather scan pings each source as it truly settles, sweep runs, score counts up, cards cascade with earned-edge flash; verify scan + match reveal (real UID `0x8045e3d1…ca743`); attest busy motif; reduced-motion spot check (macOS Reduce Motion or DevTools emulation → static states everywhere); mobile-width sanity. Then merge, push, `vercel deploy --prod`, re-smoke prod.
