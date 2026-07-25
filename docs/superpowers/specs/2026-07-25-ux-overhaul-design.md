# UX Overhaul — Landing, Routed Flow, Chrome (Design)

**Date:** 2026-07-25
**Status:** Approved by Francisco (conversation, 2026-07-25)
**Builds on:** `2026-07-24-open-builder-score-stack-design.md` (POC, complete through e2e attest)

## Goal

Turn the single-page POC into a small three-screen app: a landing page that
explains the Builder Score, an input screen reached via an optional
connect-wallet shortcut, and a results screen with the score breakdown and
attestation. Add a header and footer. No changes to scoring, fetching, or
attestation logic.

## Decisions (settled with Francisco)

1. **Connecting a wallet is an optional shortcut, not a gate.** The landing
   page's primary CTA connects and routes to the input screen with the
   address pre-filled; a secondary link goes there without connecting. The
   permissionless "look up anyone" flow is preserved.
2. **URL-driven routes** (approach A): results live at a shareable URL and
   recompute on load — anyone opening the link has *their* browser recompute
   the score, matching the verify-by-recomputing ethos. Refresh-safe; back
   button works; landing is a static server component with real metadata.

## Routes

### `/` — Landing (server component, static)

Content, top to bottom:

- **Hero:** "Open Builder Score" + one-liner: a Builder Score computed
  entirely in your browser from public data — no backend, no accounts.
- **Three value props** (short cards or columns):
  - *Computed in your browser* — public RPC + public APIs, nothing leaves
    your machine except the queries themselves.
  - *Attested onchain* — one click publishes an EAS attestation anyone can
    verify by recomputing.
  - *Anyone can run it* — open spec, open math; the same inputs always
    produce the same score.
- **How it works** (4 numbered steps):
  1. Enter any wallet address (and optionally a GitHub handle).
  2. Your browser queries public data across 6 chains and GitHub.
  3. Every point comes with the exact formula that produced it.
  4. Optionally attest the score on Base — verifiable by anyone.
- **CTA block** (client island, `landing-cta.tsx`):
  - Primary button: if disconnected, opens the RainbowKit connect modal and
    routes to `/score` on successful connect (only when initiated from this
    button — no auto-redirect for already-connected visitors). If already
    connected, routes to `/score` immediately.
  - Secondary: "or check any address" link → `/score`.

The landing page exports `metadata` (it is a server component; the current
root-layout metadata stays as the default).

### `/score` — Input (client)

- Wallet address field + optional GitHub handle field (same fields as
  today's form).
- **Prefill precedence:** query params (`?wallet=&github=`, used by the
  results screen's "edit inputs" link) > connected wallet address > empty.
  The connected-wallet prefill applies only while the field is untouched —
  it never clobbers a user edit.
- Validation: viem `isAddress` on submit; inline error on failure.
- Submit navigates to the results URL (no computation on this screen).
- Note: `useSearchParams` requires a `Suspense` boundary for prerendering in
  Next 16 — wrap the form accordingly.

### `/score/[wallet]` — Results (client), `?github=` optional

- Parses wallet from the path segment, GitHub handle from query params.
- Invalid address in URL → friendly error card + link back to `/score`.
- On mount: existing `gatherInputs` → `computeScore` (unchanged), with the
  existing loading state while gathering.
- Displays: total-score hero, credential card grid, as-of footnote, attest
  panel — reusing `credential-card.tsx` and `attest-panel.tsx` unchanged.
- "Edit inputs" link → `/score?wallet=<addr>&github=<handle>` (params carry
  the current values back).

## Chrome

- **Header** (all pages, client component `header.tsx`): "Open Builder
  Score" wordmark linking to `/`, RainbowKit `<ConnectButton />` on the
  right. Nothing else.
- **Footer** (all pages, `footer.tsx`): spec version read from `spec.json`,
  link to EAS schema #2265 on base-sepolia.easscan.org, tagline "Computed
  entirely in your browser from public data. No backend."
- `layout.tsx` renders `<Header />` and `<Footer />` around `{children}`,
  inside `<Providers>` (header needs wagmi context). The root layout remains
  a server component.

## Shared route helper

`src/lib/routes.ts` — pure helper `scorePath(wallet, github)` returning the
results path (github omitted when empty), used by both the input screen's
submit and the results screen's edit link, with unit tests. Keeps the URL
shape defined in exactly one place.

## File plan

- Modify: `src/app/page.tsx` (becomes landing), `src/app/layout.tsx`
  (header/footer).
- Create: `src/app/score/page.tsx`, `src/app/score/[wallet]/page.tsx`,
  `src/components/header.tsx`, `src/components/footer.tsx`,
  `src/components/landing-cta.tsx`, `src/lib/routes.ts`,
  `test/routes.test.ts`.
- Unchanged: everything in `src/lib/` except the new `routes.ts` and moving
  the `Scored` interface from `page.tsx` into `orchestrate.ts` (it can no
  longer live in `page.tsx` once that file becomes the landing);
  `credential-card.tsx`; all existing tests. `attest-panel.tsx` changes only
  its `Scored` import path (`@/app/page` → `@/lib/orchestrate`) — no
  behavior change.

## Visual direction

Keep the existing dark zinc + emerald aesthetic and extend it to the new
screens. No redesign of the credential cards or attest panel.

## Error handling

- Invalid wallet in results URL → error card with back link (no crash, no
  compute attempt).
- Per-credential failures ("couldn't check" amber state) and the
  complete-data attestation gate are unchanged.

## Testing

- All 70 existing tests must stay green (no lib changes besides the added
  `routes.ts`).
- New unit tests for `scorePath` only. No component-test infrastructure in
  this pass; screens are validated manually in the browser as before.

## Out of scope

- Vercel deploy (deferred by Francisco), Base mainnet schema, multi-wallet,
  GitHub sign-in, percentile context, embeddable widget.
