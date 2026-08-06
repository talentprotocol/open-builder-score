# Footer UI redesign

**Date:** 2026-08-06  
**Status:** Approved — ship

## Problem

The footer is a single cramped row. Adding Attestations made product nav, external links, and brand weight collide — especially on mobile.

## Constraints

- Keep all existing content: theme toggle, tagline, Credentials, Badges, Verify, Attestations, EAS schema, Talent wordmark.
- Stay within existing Talent gray tokens and `max-w-3xl` chrome.
- Structure + visual polish only; no new copy or destinations.

## Design

Two-row utility footer:

1. **Meta row** — theme toggle + tagline (`text-sm text-muted-foreground`).
2. Hairline `border-border` divider.
3. **Nav row** — product links left (Credentials, Badges, Verify, Attestations); EAS schema + Talent wordmark right, quieter.

### Visual tokens

| Role | Treatment |
|------|-----------|
| Tagline | `text-sm text-muted-foreground` |
| Product links | `text-sm`, ~60% opacity → 100% on hover/focus |
| External / brand | ~40% opacity → 100% on hover/focus |
| Spacing | `py-4`, row `gap-3`, product `gap-x-4 gap-y-2`, external `gap-3` |
| Motion | Opacity only; no new animation |
| Focus | Rely on existing global focus-visible rings |

### Mobile

Meta stacks if needed; product links wrap; external/brand wraps with the same quieter weight.

## Out of scope

Labeled column groups, wider max-width, new nav items, motion beyond opacity.
