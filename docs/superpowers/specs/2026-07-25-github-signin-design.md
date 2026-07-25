# GitHub Sign-In via Device Flow (Design)

**Date:** 2026-07-25
**Status:** Approved via roadmap delegation; OAuth app created by Francisco
(client ID `Ov23lifhhYZia6r3ZYv3`, Device Flow enabled).

## Goal

Prove ownership of the GitHub handle that goes into scores and attestations,
and lift the unauthenticated 60 req/hr GitHub rate limit to 5,000 req/hr for
signed-in users. Closes the integrity gap where any handle could be attested.

## Key decisions

1. **Device flow, zero scopes.** No redirects, no client secret, public data
   only — the token merely identifies the user and raises rate limits.
2. **The sanctioned "stateless CORS/token worker" (README ground rules) is
   implemented as two in-repo Next.js route handlers** rather than separate
   infra: GitHub's device-flow endpoints send no CORS headers, so the browser
   can't call them; same-origin passthroughs need no CORS at all and deploy
   with the app. They hold no secrets, no state, and pin both `client_id` and
   `grant_type` server-side so they are not an open proxy. The scoring path
   remains 100% client-side; only sign-in touches these routes.
3. **`GITHUB_CLIENT_ID` is committed** — a public identifier, same precedent
   as the WalletConnect projectId.
4. **Token in `sessionStorage`** (per-tab, gone on close). Scope-less token =
   low blast radius.
5. **Attestation gate:** attesting a score that includes a GitHub handle
   requires that handle to be verified (case-insensitive match with the
   signed-in login). Handle-less attestation is unrestricted. This is a
   UI-level guarantee (the honest default path), not a protocol-level proof —
   framed accordingly.

## Pieces

### `src/lib/github-auth.ts` (framework-free, injectable fetch)

- `GITHUB_CLIENT_ID = 'Ov23lifhhYZia6r3ZYv3'`.
- `requestDeviceCode(fetchFn?)` → POST `/api/github/device-code` →
  `{status:'ok', code: {deviceCode, userCode, verificationUri, interval}}`
  or `{status:'error', reason}` (snake_case → camelCase mapping, tolerant).
- `pollForToken(deviceCode, intervalSeconds, opts?)` with injectable
  `fetchFn`, `sleep`, `shouldStop` — polls POST `/api/github/token`,
  handling `authorization_pending` (continue), `slow_down` (+5s), `
  expired_token`, `access_denied`; hard cap of 180 iterations. Returns
  `{status:'token', token} | {status:'denied'} | {status:'expired'} |
  {status:'cancelled'} | {status:'error', reason}`.
- `fetchAuthenticatedUser(token, fetchFn?)` → GET `https://api.github.com/user`
  (api.github.com does send CORS headers — called directly) → `{status:'ok',
  login}` or error.
- `authorizedFetch(token): typeof fetch` — wraps fetch adding
  `Authorization: Bearer` (merges plain-object headers, which is all
  `github.ts` uses).

### Route handlers

- `src/app/api/github/device-code/route.ts` — POST; rejects unless body
  `client_id === GITHUB_CLIENT_ID`; forwards to
  `https://github.com/login/device/code` with `Accept: application/json`;
  relays JSON + status.
- `src/app/api/github/token/route.ts` — POST; requires our `client_id` and a
  string `device_code`; forwards with the device-flow `grant_type` pinned
  server-side.

### Auth store + hook

- `src/lib/github-auth-store.ts`: sessionStorage-backed
  `{token, login}` with `getGithubAuth` / `setGithubAuth` /
  `clearGithubAuth` / `subscribeGithubAuth`. A module-level snapshot cache
  keeps `getGithubAuth` referentially stable (required by
  `useSyncExternalStore`); set/clear update the cache and dispatch a custom
  event; cross-tab `storage` events invalidate. SSR-safe (null on server).
- `src/components/use-github-auth.ts`: `useGithubAuth()` via
  `useSyncExternalStore(subscribe, getSnapshot, () => null)`.

### UI

- `src/components/github-sign-in.tsx`: states idle → starting → code shown
  (user code + link to `github.com/login/device`, polling with cancel) →
  verified chip "✓ Signed in as @login" + sign out; errors inline with
  retry. Optional `onVerified(login)` callback.
- `/score` form: component sits under the GitHub handle field; on verify it
  fills the handle field; an untouched empty handle field prefills from an
  existing session (mirroring the wallet-prefill pattern).
- Results page: `· verified` marker next to `@handle` when it matches the
  signed-in login; when signed in, `gatherInputs` gets a `github` fetcher
  override using `authorizedFetch(token)` (5,000 req/hr). Same override on
  the verifier's recompute.
- Attest panel: when `scored.githubHandle` is set and ≠ signed-in login,
  the attest controls are replaced by an amber note explaining the handle
  must be verified (sign in on the form screen) before attesting.

## Constraints carried forward

No new dependencies; no changes to engine/fetchers (`github.ts` untouched —
the override goes through the existing `fetchers` seam); URL helpers for
internal routes; zinc + emerald aesthetic; all existing tests stay green;
new libs unit-tested with injectable I/O.

## Out of scope

Protocol-level handle proofs (gist/attestation-based), OAuth web flow,
token refresh (device-flow tokens don't expire quickly; session-scoped is
fine), storing tokens beyond the tab session.
