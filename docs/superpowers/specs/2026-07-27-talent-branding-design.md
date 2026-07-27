# Talent Branding — Design Spec

**Date:** 2026-07-27
**Status:** Approved (pending spec review)
**Goal:** Make Open Builder Score look and feel like a Talent Protocol product — adopting Talent's token system, typography, component idioms, theming, and brand marks — while preserving the app's signal-scan motion language intact.

Reference implementation: `~/Documents/workspace/talentprotocol/talent-apps` (source of truth: `packages/tailwind-config/shared-styles.css`, `packages/ui`, `apps/talent-app`).

## Decisions (locked)

1. **Emerald = signal only.** All chrome (surfaces, text, borders, buttons, links) adopts Talent's monochrome system. Emerald survives only where it carries meaning: scan motifs (blueprint grid, sweep, ping dots, earned flash), earned/verified/success states. Rationale: emerald-500 is literally Talent's `--success` token, so the app's signature reads as Talent semantics.
2. **Full light + dark theming** via next-themes, class strategy, dark default — same as talent-app.
3. **Tokens + idioms by hand.** Port the token layer and recreate component idioms in our own components. No dependency on the monorepo; no `ui:` prefix architecture; no cva/Radix/shadcn imports.
4. **Co-branded header.** Talent double-L mark + "Open Builder Score" wordmark in the header; PingDot demoted from logo to live-status atom (kept beside the name). Footer gets the lowercase "talent" wordmark. Favicon becomes the Talent icon.

## 1. Token layer

Rewrite `src/app/globals.css` to mirror Talent's system:

### Colors

Port the CSS-var set verbatim from `packages/tailwind-config/shared-styles.css`:

- Light (`:root`, gray scale, `color-scheme: light`): `--background` gray-50, `--foreground` gray-950, `--card` white, `--primary` gray-950 (primary IS foreground — monochrome), `--secondary` gray-200, `--muted` white / `--muted-foreground` gray-600, `--accent` gray-100, `--destructive` red-500, `--warning` amber-500, `--success` emerald-500, `--border`/`--input` gray-200, `--ring` gray-400.
- Dark (`.dark`, neutral scale, `color-scheme: dark`): `--background` neutral-950, `--foreground` neutral-50, `--card` neutral-900, `--primary` neutral-50, `--secondary` neutral-800, `--muted` neutral-900 / `--muted-foreground` neutral-500, `--accent` neutral-800, `--destructive` red-600, `--warning` amber-500, `--success` emerald-500, `--border`/`--input` neutral-800, `--ring` neutral-600.
- `@theme inline` maps raw vars to Tailwind color utilities; `@custom-variant dark (&:where(.dark, .dark *))` keys dark mode to the `.dark` class.
- Skip tokens we have no use for (sidebar-*, chart-* may be omitted until needed).

### Signal tokens (app-specific extension)

- `--signal: var(--success)` — the one brand-signature color.
- Per-theme alpha derivatives (values to be tuned visually during implementation):
  - `--grid-line`: blueprint grid line color — dark ≈ `color-mix(in oklab, var(--signal) 4%, transparent)`, light needs its own alpha (~6–8%) to read on gray-50.
  - Sweep gradient stops, focus/CTA glow shadows, earned-flash ring — all via `color-mix()` off `--signal`, defined per theme.

### Typography

- Fonts in `src/app/layout.tsx` via next/font/google, same pattern as talent-app: `Cal_Sans({ variable: "--font-cal-sans", weight: "400" })`, `Geist({ variable: "--font-geist-sans" })`, `Geist_Mono({ variable: "--font-geist-mono" })`.
- `--font-sans` → Geist (becomes the actual body font — **fixes the current bug where body font-family is Arial**), `--font-mono` → Geist Mono, `--font-heading` → Cal Sans exposed as a `font-heading` utility.
- Port Talent's remapped type scale: text-xs 10px/15px · text-sm 12px/18px · text-base 14px/21px (body default) · text-md 16px/24px · text-lg 18px/1.2 · text-xl 24px/1.2 · text-2xl 36px/1.2 · text-3xl 48px/1.2.
- **Migration hazard (explicit plan step):** the scale shift is NOT find-replace. Current `text-sm` body copy (14px today) must become `text-base` (14px under new scale); current `text-xs` (12px) → `text-sm`; current `text-[10px]` micro-captions → `text-xs` (exactly 10px). Every `text-*` occurrence gets audited and remapped individually.

### Shape & elevation

- `--radius: 0.625rem`; derived `--radius-sm` 6px / `--radius-md` 8px / `--radius-lg` 10px / `--radius-xl` 14px.
- Hairline 1px borders everywhere (`* { border-color: var(--border) }` global like Talent's).
- Elevation via border + `bg-card` + `shadow-xs`, not glows. Glows remain only as signal-language effects.
- Focus: Talent idiom — `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]` — everywhere except the scan-console exception (§3).

## 2. Theming

- `next-themes` (new dependency): `attribute="class"`, `defaultTheme="dark"`, `enableSystem`, `enableColorScheme`, `disableTransitionOnChange`. `<html suppressHydrationWarning>`.
- ThemeToggle component (hand-written, Phosphor icons, cycles dark → light → system) in the footer, matching talent-app placement.
- Theme switches kill transitions (via `disableTransitionOnChange`); Motion-driven color interpolation is removed from ping-dot (§3) so theme flips are instant and clean.
- RainbowKit: pass matching `lightTheme()`/`darkTheme()` (accent = foreground-ish, matching monochrome) synced with the active theme so the wallet modal follows.
- The blueprint grid, sweep, glows, and all signal alphas are tuned per theme via the tokens in §1.

## 3. Signal-scan language — preserved, re-plumbed

**Behavioral invariant: no motion changes.** Springs (SPRING 260/26, SPRING_SOFT 170/26), stagger 0.05s, route transitions, 1.1s odometer ease, 2.6s sweep loop, ping choreography, verdict-match scale-spring pop, AnimatePresence flows, `MotionConfig reducedMotion="user"` — all stay byte-identical in behavior.

Re-plumbing (the four hardcoded literals):

1. `.blueprint-grid` (`globals.css`): `rgba(52,211,153,0.04)` gradient stops → `var(--grid-line)`, per-theme values.
2. `ping-dot.tsx`: Motion animates literal `#34d399` backgroundColor/borderColor. Restructure: color flip via CSS class + `transition-colors`; Motion keeps driving ring scale/opacity only. Settled color = `var(--signal)`.
3. Earned-card flash (`score/[wallet]/page.tsx`): `boxShadow` keyframes `rgba(52,211,153,0.55)` → `color-mix()` off `--signal` (Motion can animate a boxShadow string built from a resolved token; simplest is a CSS var for the composed shadow color).
4. Focus/CTA glows (`score/page.tsx` ×3, `landing-cta.tsx`): arbitrary-value shadows `rgba(16,185,129,…)` → signal tokens. Note the landing CTA glow **dies entirely** (CTA becomes monochrome chrome, §4); the focus glow survives only per the exception below.

**Where emerald remains:** blueprint grid, sweep overlay, ping dots (settled), earned credential states, verified badges, verdict-match banner, "SCANNING" captions in their active state, attestation-success links.

**The one deliberate exception:** scan-form inputs (the three inputs on /score and the UID input on /verify) keep a faint signal focus glow — they are the instrument console. Everything else gets the standard Talent focus ring.

## 4. Component re-skin

New shared primitives in `src/components/ui/` (hand-written, no cva): `button.tsx` (primary / secondary / ghost / success-tint variants per Talent's exact class recipes), `badge.tsx` (tint variants, compact uppercase size). Existing components restyled:

| Component | Treatment |
|---|---|
| `header.tsx` | h-12, `bg-background border-b border-border`. Vendored Talent double-L mark (inline SVG from `packages/ui/src/logos/TalentProtocolIcon.tsx`, currentColor) + "Open Builder Score" (text-base font-medium). PingDot stays beside the name as live-status atom with once-on-mount ping. ConnectButton restyled via RainbowKit theme. |
| `footer.tsx` | Talent single-row pattern: left = ThemeToggle (+ GitHub repo icon link); right = text links (Verify, spec, EAS schema) at `opacity-50 hover:opacity-100`, external links suffixed ArrowUpRight (Phosphor, size-3); lowercase "talent" wordmark (vendored `TalentProtocolLogo.tsx`) linking to talentprotocol.com. Transparency line stays. |
| `landing-cta.tsx` | Primary = inverted monochrome block (`bg-foreground text-background hover:bg-foreground/90`, h-9 rounded-md text-base font-medium border). Emerald hover glow removed. |
| `credential-card.tsx` | Talent card shell: `rounded-md md:rounded-xl border bg-card dark:bg-card/50 shadow-xs`. Earned = `border-success/30 bg-success/10 text-success` accents; not_earned = muted; unavailable = warning tints (`border-warning/30 bg-warning/10`). |
| `hero-scan.tsx`, scan panels | Panel chrome to `border-border bg-card/…`; grid/sweep/ping via signal tokens; captions to token colors (`text-success/70` active, `text-muted-foreground` passive). |
| `attest-panel.tsx` | Buttons to primitives (primary monochrome; success states in success tints). Gate/info text in muted-foreground; amber warnings → warning tokens. |
| `attestation-history.tsx`, `score-percentile.tsx` | Neutral text tokens; revoked strikethrough muted; Verify links standard link styling. |
| `github-sign-in.tsx` | Chip = Talent badge idiom; buttons to primitives; crossfade animation untouched. |
| `copy-link-button.tsx` | Secondary button idiom; scale-pulse untouched. |
| Score display | Big number `font-mono tracking-tighter` (Talent metric idiom), `/max` and labels in `text-muted-foreground`. Odometer untouched. |
| Verify verdict banners | Match = success tints + spring pop (unchanged); diverged/incomplete/revoked = warning tints; invalid = destructive. |
| Icons | Phosphor (`@phosphor-icons/react`, new dependency) for all iconography (arrows, copy, check, theme toggle). Text ✓ marks inside sentences may stay as text. |

Brand assets, vendored into `src/components/brand/`: `talent-icon.tsx` (double-L mark) and `talent-wordmark.tsx` (lowercase "talent"), copied as inline SVG from `packages/ui/src/logos/`, currentColor. Favicon/app icon from talent-app's `public/icon.png` (replaces stock Next favicon).

## 5. Copy & metadata

- Headings move to `font-heading` (Cal Sans) at `font-normal` per Talent convention.
- Voice pass (light touch): "builders" vocabulary where natural; CTAs stay 1–3-word imperatives; no exclamation marks. Signature lines stay: "A builder score you don't have to trust.", "Computed entirely in your browser… No backend.", "You sign, you pay."
- Tracked-uppercase mono micro-captions (SCANNING SOURCES / COMPUTED IN YOUR BROWSER) stay — they are the instrument voice.
- Metadata: root + per-route titles keep "Open Builder Score"; description/footer gain "by Talent Protocol".

## 6. Out of scope

- No nav/sidebar restructure; single-column `max-w-3xl` layout stays.
- No `@talent/ui` package dependency; no `ui:` prefix; no cva/Radix.
- No product-behavior, engine, spec, or scoring changes; no API changes.
- No OG-image generation work.
- No Builder Score renaming.

## 7. Error handling

No behavioral changes. All existing states (loading / error / partial / not_comparable / invalid) keep their logic; only their colors move to tokens (error → destructive, partial/degraded → warning, verified → success).

## 8. Testing & verification

- Existing vitest suite (78 tests, lib/engine-level) must stay green — UI-only change should not touch them.
- Browser verification pass over all 5 screens (landing, /score, /score/[wallet], /verify, /verify/[uid]) in **both themes**: token correctness, scan-motif legibility (grid/sweep visible but quiet in light mode), focus states, RainbowKit modal theming.
- Reduced-motion pass (motifs already guard; verify nothing regressed).
- Contrast sanity: success-on-light text usages should sit on tints (`bg-success/10`) per Talent's own pattern, not bare on gray-50.
- Theme-switch pass: instant flip, no transition artifacts, no hydration warnings.

## 9. Risks

1. **Type-scale port** — every `text-*` shifts meaning; must be remapped per-occurrence, not find-replaced (§1).
2. **Light-mode signal tuning** — grid/sweep/glow alphas tuned for near-black will be invisible or garish on gray-50; needs visual iteration.
3. **Ping-dot restructure** — moving color out of Motion interpolation must not break the ring ping choreography.
4. **RainbowKit theming** — third-party modal may need CSS-var overrides to fully match.
