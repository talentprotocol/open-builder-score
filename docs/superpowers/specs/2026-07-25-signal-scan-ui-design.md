# Signal Scan UI (Design)

**Date:** 2026-07-25
**Status:** Approved by Francisco via visual-companion session (direction "A —
Signal Scan" chosen over Constellation and Terminal Forge live motion
sketches; whole-app scope confirmed; reference sketch preserved at
`.superpowers/brainstorm/31070-1784999932/content/visual-direction-v2.html`).

## Goal

Make the app feel futuristic and self-explanatory before team feedback: the
many loading states become one coherent "signal scan" motion language that
*shows* data being gathered and computed in-browser, with a score reveal
that lands the wow.

## Design principles

1. **Motion carries the futurism; chrome stays clean.** Zinc + emerald
   unchanged. Dark surfaces gain a barely-there emerald blueprint grid; loud
   effects (sweep, pings, odometer) are reserved for moments of real
   computation. The app animates *because it's working*, never as
   decoration.
2. **Motion never lies and never delays.** Source rows ping on real
   `onSourceSettled` events; nothing is artificially slowed for drama;
   partial results keep their amber honesty.
3. **One physics.** A single spring-preset family; every entrance,
   cascade, and reveal uses it.
4. **Reduced motion is first-class.** Global
   `<MotionConfig reducedMotion="user">` + CSS `prefers-reduced-motion`
   guards on pure-CSS loops; every state remains fully legible with
   animation off.

## Tech

- New dependency (the first since RainbowKit, sanctioned by Francisco):
  **`motion`** (Motion for React, the framer-motion successor). Imports
  from `motion/react`. Transform/opacity animations only; grid and sweep are
  CSS gradients — no canvas.

## Pieces

### Motion foundation — `src/components/motion/`

- `presets.ts` — `SPRING` (default), `SPRING_SOFT` (large surfaces), shared
  variants for fade-rise and stagger.
- `fade-rise.tsx` — `<FadeRise>` entrance wrapper (opacity 0→1, y 14→0,
  spring; optional `delay`, `whileInView` mode for landing scroll reveals).
- `stagger.tsx` — `<Stagger>` / `<StaggerItem>` for cascades
  (`staggerChildren` ~0.05s).
- `score-count-up.tsx` — `<ScoreCountUp value>` springs the displayed
  integer 0→value (tabular-nums; renders the final value immediately under
  reduced motion).
- `ping-dot.tsx` — `<PingDot settled>` checklist dot: hollow → emerald fill
  with one expanding ring pulse when `settled` flips true.
- `sweep-overlay.tsx` — `<SweepOverlay>` absolutely-positioned radar line
  looping top→bottom (motion loop) inside a `relative overflow-hidden`
  parent; hidden under reduced motion.
- `<MotionConfig reducedMotion="user">` wraps the app in
  `src/app/providers.tsx`.
- `globals.css` gains `.blueprint-grid` (the two faint emerald
  linear-gradients, 22px cell).

### Screen treatments

- **Gather → score (centerpiece, results page):** the loading checklist
  becomes a scan panel — blueprint grid, sweep line, four source rows with
  `PingDot`s firing on real settle events, "SCANNING SOURCES" caption
  flipping to "COMPUTED IN YOUR BROWSER"; on done the panel exits and the
  score header enters: `ScoreCountUp` total, credential cards cascade via
  `Stagger` (earned cards flash a brief emerald edge via a one-shot border
  animation), percentile/attest/history sections `FadeRise` in sequence.
- **Landing:** hero gains `hero-scan.tsx` — a compact self-running scan
  loop (4 mini source rows ping cyclically, mini count-up, loops forever;
  pure presentation, no fetching) beside the headline; content sections
  `FadeRise whileInView` on scroll; CTA hover glow.
- **Input:** form card `FadeRise` on entry; inputs get focus glow
  (`focus:ring` emerald + soft shadow); extra wallet rows animate in/out
  with `AnimatePresence` + layout springs; GitHub sign-in state changes
  (idle → code → chip) transition with `AnimatePresence`.
- **Verify:** the recompute uses the same scan motif (sweep + ping rows via
  the shared components); the verdict banner is the reveal — ✓ match enters
  with a scale-spring + one emerald ring pulse; diverged/malformed (red)
  and not-comparable (amber) enter with a calmer fade (respectful, not
  celebratory). `/verify` input screen gets the standard entrance.
- **Small states:** ENS resolving and attest-pending swap static text for a
  compact scanning row (PingDot pulse + label); copy-link button pulses
  once on copy; percentile line `FadeRise`s in when it resolves.
- **Global:** `.blueprint-grid` on the app shell behind content;
  `src/app/template.tsx` gives every route a subtle fade-rise entrance;
  header logo dot pings once on mount; footer unchanged.

## Guardrails

- Zero logic changes: pages keep their state machines, fetchers, and URLs;
  motion components wrap presentation only. All 163 existing tests stay
  green; no test rewrites — new motion components carry no business logic.
- Bundle: `motion` ≈ 18kb gzip accepted; no other additions.
- Accessibility: all information conveyed by motion is also present
  statically (✓ marks, text captions); reduced-motion users get instant
  final states; no flashing above 3Hz.
- The Turbopack JSX whitespace gotcha applies to all new JSX copy.

## Out of scope

Sound, canvas/WebGL effects, theming beyond zinc+emerald, changing layout
structure or information architecture, OG-image animation.
