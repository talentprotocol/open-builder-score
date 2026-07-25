# GitHub Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub device-flow sign-in that verifies handle ownership, gates handle-bearing attestations on verification, and authenticates GitHub API reads (5,000 req/hr).

**Architecture:** A framework-free `github-auth.ts` lib (device-code request, token polling, user fetch, authorized fetch wrapper) with injectable I/O; two client-ID-pinned stateless Next route handlers proxying GitHub's CORS-less device-flow endpoints; a sessionStorage auth store with a `useSyncExternalStore` hook; a sign-in component on the form; fetcher overrides through `gatherInputs`' existing seam; an attest-panel verification gate.

**Tech Stack:** Next.js 16 route handlers, React 19 (`useSyncExternalStore`), Vitest (`vi.stubGlobal` for route tests).

**Spec:** `docs/superpowers/specs/2026-07-25-github-signin-design.md`

## Global Constraints

- Never add a `webpack:` key to `next.config.ts`; leave `turbopack.ignoreIssue` untouched.
- No new dependencies. Zero secrets (`GITHUB_CLIENT_ID = 'Ov23lifhhYZia6r3ZYv3'` is a public identifier, committed by design). Zero env vars.
- The route handlers are the README-sanctioned stateless worker: they must hold no state, no secrets, and must pin `client_id` (and `grant_type` on the token route) server-side — never a general-purpose proxy.
- `src/lib/github.ts`, `engine.ts`, `chains.ts`, `orchestrate.ts`, `easscan.ts`, `speedrun.ts`, `eas.ts`, `verify.ts`, `history.ts`, `ens.ts`, `routes.ts` all unchanged — the authenticated override goes through `gatherInputs`' existing `fetchers` parameter.
- URL shapes for internal routes via `@/lib/routes` helpers only. The two API endpoint paths (`/api/github/device-code`, `/api/github/token`) are defined as exported constants in `github-auth.ts` and used by both the lib and any tests — never retyped inline elsewhere.
- All 118 existing tests stay green; new tests in `test/github-auth.test.ts`, `test/github-auth-store.test.ts`, `test/github-api-routes.test.ts`.
- Visuals: dark zinc + emerald aesthetic; amber for warning states.
- If `npm run typecheck` fails inside `.next/dev/types`, run `npm run build` first and retry — known transient.
- Work happens on branch `feat/github-signin`.

---

### Task 1: Device-flow lib

**Files:**
- Create: `src/lib/github-auth.ts`
- Test: `test/github-auth.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2, 4, 5): `GITHUB_CLIENT_ID: string`; `DEVICE_CODE_ENDPOINT = '/api/github/device-code'`; `TOKEN_ENDPOINT = '/api/github/token'`; `requestDeviceCode(fetchFn?): Promise<DeviceCodeResult>`; `pollForToken(deviceCode, intervalSeconds, opts?): Promise<PollResult>`; `fetchAuthenticatedUser(token, fetchFn?): Promise<UserResult>`; `authorizedFetch(token): typeof fetch`; types `DeviceCode`, `DeviceCodeResult`, `PollResult`, `UserResult`.

- [ ] **Step 1: Write the failing tests**

Create `test/github-auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  authorizedFetch,
  DEVICE_CODE_ENDPOINT,
  fetchAuthenticatedUser,
  GITHUB_CLIENT_ID,
  pollForToken,
  requestDeviceCode,
  TOKEN_ENDPOINT,
} from '@/lib/github-auth'

const noSleep = async () => {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('requestDeviceCode', () => {
  it('posts our client id and maps snake_case', async () => {
    let captured: { url: string; body: string } | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body) }
      return jsonResponse({
        device_code: 'dev123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      })
    }) as typeof fetch
    const result = await requestDeviceCode(fakeFetch)
    expect(result).toEqual({
      status: 'ok',
      code: {
        deviceCode: 'dev123',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        interval: 5,
      },
    })
    expect(captured!.url).toBe(DEVICE_CODE_ENDPOINT)
    expect(captured!.body).toContain(GITHUB_CLIENT_ID)
  })
  it('maps HTTP failures and junk shapes to error', async () => {
    const httpFail = (async () => jsonResponse({}, 500)) as typeof fetch
    expect((await requestDeviceCode(httpFail)).status).toBe('error')
    const junk = (async () => jsonResponse({ nope: true })) as typeof fetch
    expect((await requestDeviceCode(junk)).status).toBe('error')
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await requestDeviceCode(netFail)).status).toBe('error')
  })
})

describe('pollForToken', () => {
  it('polls through authorization_pending to a token', async () => {
    const responses = [
      jsonResponse({ error: 'authorization_pending' }),
      jsonResponse({ error: 'authorization_pending' }),
      jsonResponse({ access_token: 'tok123', token_type: 'bearer' }),
    ]
    let calls = 0
    const fakeFetch = (async (url: unknown) => {
      expect(String(url)).toBe(TOKEN_ENDPOINT)
      return responses[calls++]
    }) as typeof fetch
    const result = await pollForToken('dev123', 5, { fetchFn: fakeFetch, sleep: noSleep })
    expect(result).toEqual({ status: 'token', token: 'tok123' })
    expect(calls).toBe(3)
  })
  it('slows down on slow_down and still succeeds', async () => {
    const sleeps: number[] = []
    const responses = [
      jsonResponse({ error: 'slow_down', interval: 10 }),
      jsonResponse({ access_token: 'tok123' }),
    ]
    let calls = 0
    const fakeFetch = (async () => responses[calls++]) as typeof fetch
    const result = await pollForToken('dev123', 5, {
      fetchFn: fakeFetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(result.status).toBe('token')
    expect(sleeps[0]).toBe(5000)
    expect(sleeps[1]).toBe(10000)
  })
  it('maps access_denied and expired_token', async () => {
    const denied = (async () => jsonResponse({ error: 'access_denied' })) as typeof fetch
    expect(await pollForToken('d', 1, { fetchFn: denied, sleep: noSleep })).toEqual({
      status: 'denied',
    })
    const expired = (async () => jsonResponse({ error: 'expired_token' })) as typeof fetch
    expect(await pollForToken('d', 1, { fetchFn: expired, sleep: noSleep })).toEqual({
      status: 'expired',
    })
  })
  it('stops when shouldStop flips', async () => {
    const pending = (async () => jsonResponse({ error: 'authorization_pending' })) as typeof fetch
    let polls = 0
    const result = await pollForToken('d', 1, {
      fetchFn: (async (...args: Parameters<typeof fetch>) => {
        polls++
        return pending(...args)
      }) as typeof fetch,
      sleep: noSleep,
      shouldStop: () => polls >= 2,
    })
    expect(result).toEqual({ status: 'cancelled' })
  })
  it('maps network failures to error', async () => {
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect((await pollForToken('d', 1, { fetchFn: netFail, sleep: noSleep })).status).toBe('error')
  })
})

describe('fetchAuthenticatedUser', () => {
  it('sends the bearer token and returns the login', async () => {
    let auth: string | null = null
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.github.com/user')
      auth = (init?.headers as Record<string, string>).Authorization
      return jsonResponse({ login: 'octocat' })
    }) as typeof fetch
    const result = await fetchAuthenticatedUser('tok123', fakeFetch)
    expect(result).toEqual({ status: 'ok', login: 'octocat' })
    expect(auth).toBe('Bearer tok123')
  })
  it('maps failures to error', async () => {
    const httpFail = (async () => jsonResponse({}, 401)) as typeof fetch
    expect((await fetchAuthenticatedUser('t', httpFail)).status).toBe('error')
  })
})

describe('authorizedFetch', () => {
  it('adds the Authorization header while preserving existing headers', async () => {
    const original = globalThis.fetch
    let seen: Record<string, string> | null = null
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>
      return jsonResponse({})
    }) as typeof fetch
    try {
      const wrapped = authorizedFetch('tok123')
      await wrapped('https://api.github.com/users/octocat', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      expect(seen).toEqual({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer tok123',
      })
    } finally {
      globalThis.fetch = original
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/github-auth.test.ts`
Expected: FAIL — cannot resolve `@/lib/github-auth`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/github-auth.ts`:

```ts
// GitHub OAuth device flow (zero scopes). The client ID is a public
// identifier — same precedent as the WalletConnect projectId.
export const GITHUB_CLIENT_ID = 'Ov23lifhhYZia6r3ZYv3'

// Same-origin passthrough routes (GitHub's device-flow endpoints send no
// CORS headers, so the browser can't call them directly).
export const DEVICE_CODE_ENDPOINT = '/api/github/device-code'
export const TOKEN_ENDPOINT = '/api/github/token'

const MAX_POLLS = 180

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
}

export type DeviceCodeResult =
  | { status: 'ok'; code: DeviceCode }
  | { status: 'error'; reason: string }

export type PollResult =
  | { status: 'token'; token: string }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'error'; reason: string }

export type UserResult = { status: 'ok'; login: string } | { status: 'error'; reason: string }

export async function requestDeviceCode(fetchFn: typeof fetch = fetch): Promise<DeviceCodeResult> {
  try {
    const response = await fetchFn(DEVICE_CODE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID }),
    })
    if (!response.ok) return { status: 'error', reason: `GitHub sign-in failed (${response.status})` }
    const raw = (await response.json()) as Record<string, unknown>
    if (
      typeof raw.device_code !== 'string' ||
      typeof raw.user_code !== 'string' ||
      typeof raw.verification_uri !== 'string'
    ) {
      return { status: 'error', reason: 'GitHub returned an unexpected shape' }
    }
    const interval = Number(raw.interval ?? 5)
    return {
      status: 'ok',
      code: {
        deviceCode: raw.device_code,
        userCode: raw.user_code,
        verificationUri: raw.verification_uri,
        interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
      },
    }
  } catch {
    return { status: 'error', reason: 'GitHub sign-in is unreachable' }
  }
}

export async function pollForToken(
  deviceCode: string,
  intervalSeconds: number,
  opts: {
    fetchFn?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    shouldStop?: () => boolean
  } = {},
): Promise<PollResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let interval = intervalSeconds
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(interval * 1000)
    if (opts.shouldStop?.()) return { status: 'cancelled' }
    try {
      const response = await fetchFn(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, device_code: deviceCode }),
      })
      if (!response.ok) return { status: 'error', reason: `GitHub sign-in failed (${response.status})` }
      const raw = (await response.json()) as Record<string, unknown>
      if (typeof raw.access_token === 'string') return { status: 'token', token: raw.access_token }
      switch (raw.error) {
        case 'authorization_pending':
          continue
        case 'slow_down': {
          const next = Number(raw.interval ?? interval + 5)
          interval = Number.isFinite(next) && next > interval ? next : interval + 5
          continue
        }
        case 'expired_token':
          return { status: 'expired' }
        case 'access_denied':
          return { status: 'denied' }
        default:
          return { status: 'error', reason: 'GitHub returned an unexpected shape' }
      }
    } catch {
      return { status: 'error', reason: 'GitHub sign-in is unreachable' }
    }
  }
  return { status: 'expired' }
}

export async function fetchAuthenticatedUser(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<UserResult> {
  try {
    const response = await fetchFn('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return { status: 'error', reason: `GitHub user lookup failed (${response.status})` }
    const raw = (await response.json()) as Record<string, unknown>
    if (typeof raw.login !== 'string') {
      return { status: 'error', reason: 'GitHub returned an unexpected shape' }
    }
    return { status: 'ok', login: raw.login }
  } catch {
    return { status: 'error', reason: 'GitHub is unreachable' }
  }
}

// Wraps fetch to authenticate api.github.com reads (5,000 req/hr). Merges
// plain-object headers only — which is all src/lib/github.ts passes.
export function authorizedFetch(token: string): typeof fetch {
  return (input, init = {}) =>
    fetch(input, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/github-auth.test.ts` → PASS (9 tests).
Run: `npm test` → 127 tests. `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/github-auth.ts test/github-auth.test.ts
git commit -m "feat: GitHub device-flow auth lib"
```

---

### Task 2: Passthrough route handlers

**Files:**
- Create: `src/app/api/github/device-code/route.ts`
- Create: `src/app/api/github/token/route.ts`
- Test: `test/github-api-routes.test.ts`

**Interfaces:**
- Consumes: `GITHUB_CLIENT_ID` from `@/lib/github-auth`.
- Produces: POST handlers at the two endpoint paths Task 1's constants name.

- [ ] **Step 1: Write the failing tests**

Create `test/github-api-routes.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as deviceCodePost } from '@/app/api/github/device-code/route'
import { POST as tokenPost } from '@/app/api/github/token/route'
import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('device-code route', () => {
  it('forwards our client id to GitHub and relays the response', async () => {
    let upstream: { url: string; body: string } | null = null
    vi.stubGlobal(
      'fetch',
      (async (url: unknown, init?: RequestInit) => {
        upstream = { url: String(url), body: String(init?.body) }
        return new Response(JSON.stringify({ device_code: 'dev123' }), { status: 200 })
      }) as typeof fetch,
    )
    const response = await deviceCodePost(jsonRequest({ client_id: GITHUB_CLIENT_ID }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ device_code: 'dev123' })
    expect(upstream!.url).toBe('https://github.com/login/device/code')
    expect(upstream!.body).toContain(GITHUB_CLIENT_ID)
  })
  it('rejects foreign client ids without contacting GitHub', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const response = await deviceCodePost(jsonRequest({ client_id: 'someone-else' }))
    expect(response.status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })
  it('rejects unparseable bodies', async () => {
    const response = await deviceCodePost(
      new Request('http://localhost/api/test', { method: 'POST', body: 'not json' }),
    )
    expect(response.status).toBe(400)
  })
})

describe('token route', () => {
  it('forwards with the device grant type pinned server-side', async () => {
    let body: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      (async (url: unknown, init?: RequestInit) => {
        expect(String(url)).toBe('https://github.com/login/oauth/access_token')
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ access_token: 'tok123' }), { status: 200 })
      }) as typeof fetch,
    )
    const response = await tokenPost(
      jsonRequest({
        client_id: GITHUB_CLIENT_ID,
        device_code: 'dev123',
        grant_type: 'urn:something-else-entirely',
      }),
    )
    expect(response.status).toBe(200)
    expect(body!.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(body!.device_code).toBe('dev123')
  })
  it('rejects foreign client ids and missing device codes', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(
      (await tokenPost(jsonRequest({ client_id: 'someone-else', device_code: 'd' }))).status,
    ).toBe(400)
    expect((await tokenPost(jsonRequest({ client_id: GITHUB_CLIENT_ID }))).status).toBe(400)
    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/github-api-routes.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Write the handlers**

Create `src/app/api/github/device-code/route.ts`:

```ts
import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

// The README-sanctioned stateless worker, colocated as a route handler:
// GitHub's device-flow endpoints send no CORS headers, so the browser cannot
// call them directly. Same-origin passthrough — no secrets, no state, and
// pinned to our own client id so it is not an open proxy.
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }
  if ((body as { client_id?: unknown })?.client_id !== GITHUB_CLIENT_ID) {
    return Response.json({ error: 'unauthorized_client' }, { status: 400 })
  }
  const upstream = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID }),
  })
  return Response.json(await upstream.json(), { status: upstream.status })
}
```

Create `src/app/api/github/token/route.ts`:

```ts
import { GITHUB_CLIENT_ID } from '@/lib/github-auth'

// Counterpart to the device-code passthrough. The grant type is pinned
// server-side so this cannot be used for any other OAuth exchange.
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }
  const clientId = (body as { client_id?: unknown })?.client_id
  const deviceCode = (body as { device_code?: unknown })?.device_code
  if (clientId !== GITHUB_CLIENT_ID || typeof deviceCode !== 'string') {
    return Response.json({ error: 'unauthorized_client' }, { status: 400 })
  }
  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  return Response.json(await upstream.json(), { status: upstream.status })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/github-api-routes.test.ts` → PASS (5 tests).
Run: `npm test` → 132 tests. `npm run typecheck` → exit 0.
Run: `npm run build` → exit 0; route list gains `ƒ /api/github/device-code` and `ƒ /api/github/token`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api test/github-api-routes.test.ts
git commit -m "feat: stateless GitHub device-flow passthrough routes"
```

---

### Task 3: Auth store + hook

**Files:**
- Create: `src/lib/github-auth-store.ts`
- Create: `src/components/use-github-auth.ts`
- Test: `test/github-auth-store.test.ts`

**Interfaces:**
- Produces: `GithubAuth = { token: string; login: string }`; `getGithubAuth(): GithubAuth | null`; `setGithubAuth(auth): void`; `clearGithubAuth(): void`; `subscribeGithubAuth(cb): () => void` (store); `useGithubAuth(): GithubAuth | null` (hook, consumed by Tasks 4–6).

- [ ] **Step 1: Write the failing tests**

Create `test/github-auth-store.test.ts` (vitest runs in a node environment without `window`/`sessionStorage` — stub them):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  } as Storage
}

beforeEach(() => {
  vi.resetModules()
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  vi.stubGlobal('window', {
    sessionStorage: makeStorage(),
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(cb)
    },
    removeEventListener: (type: string, cb: (e: unknown) => void) => {
      listeners.get(type)?.delete(cb)
    },
    dispatchEvent: (event: { type: string }) => {
      listeners.get(event.type)?.forEach((cb) => cb(event))
      return true
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function store() {
  return await import('@/lib/github-auth-store')
}

describe('github auth store', () => {
  it('round-trips set/get/clear', async () => {
    const s = await store()
    expect(s.getGithubAuth()).toBeNull()
    s.setGithubAuth({ token: 'tok', login: 'octocat' })
    expect(s.getGithubAuth()).toEqual({ token: 'tok', login: 'octocat' })
    s.clearGithubAuth()
    expect(s.getGithubAuth()).toBeNull()
  })
  it('returns a referentially stable snapshot between writes', async () => {
    const s = await store()
    s.setGithubAuth({ token: 'tok', login: 'octocat' })
    expect(s.getGithubAuth()).toBe(s.getGithubAuth())
  })
  it('notifies subscribers on set and clear', async () => {
    const s = await store()
    let calls = 0
    const unsubscribe = s.subscribeGithubAuth(() => calls++)
    s.setGithubAuth({ token: 'tok', login: 'octocat' })
    s.clearGithubAuth()
    unsubscribe()
    s.setGithubAuth({ token: 'tok2', login: 'octocat' })
    expect(calls).toBe(2)
  })
  it('tolerates junk in storage', async () => {
    const s = await store()
    window.sessionStorage.setItem('obs-github-auth', 'not json')
    expect(s.getGithubAuth()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/github-auth-store.test.ts`
Expected: FAIL — cannot resolve `@/lib/github-auth-store`.

- [ ] **Step 3: Write the store**

Create `src/lib/github-auth-store.ts`:

```ts
// Session-scoped GitHub auth (zero-scope token + verified login).
// sessionStorage-backed with a module-level snapshot cache so getGithubAuth
// is referentially stable — required by useSyncExternalStore.

const STORAGE_KEY = 'obs-github-auth'
const CHANGE_EVENT = 'obs-github-auth-changed'

export interface GithubAuth {
  token: string
  login: string
}

// undefined = not yet read; null = known absent.
let cached: GithubAuth | null | undefined

function readStorage(): GithubAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.token !== 'string' || typeof parsed.login !== 'string') return null
    return { token: parsed.token, login: parsed.login }
  } catch {
    return null
  }
}

export function getGithubAuth(): GithubAuth | null {
  if (cached === undefined) cached = readStorage()
  return cached
}

function notify(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function setGithubAuth(auth: GithubAuth): void {
  cached = auth
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
  } catch {
    // Storage unavailable: in-memory cache still works for this page.
  }
  notify()
}

export function clearGithubAuth(): void {
  cached = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to remove.
  }
  notify()
}

export function subscribeGithubAuth(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: Event) => {
    // Another tab changed sessionStorage: drop the cache and re-read.
    if ((event as StorageEvent).key === STORAGE_KEY || (event as StorageEvent).key === undefined) {
      cached = undefined
    }
    callback()
  }
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}
```

Note (test-environment nuance): `new Event(...)` exists in the vitest node environment; the stubbed `window.dispatchEvent` receives it and fans out by `type`. If the stub's `StorageEvent` cast trips typecheck, use `(event as { key?: string }).key`.

- [ ] **Step 4: Write the hook**

Create `src/components/use-github-auth.ts`:

```ts
'use client'

import { useSyncExternalStore } from 'react'
import {
  getGithubAuth,
  subscribeGithubAuth,
  type GithubAuth,
} from '@/lib/github-auth-store'

export function useGithubAuth(): GithubAuth | null {
  return useSyncExternalStore(subscribeGithubAuth, getGithubAuth, () => null)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/github-auth-store.test.ts` → PASS (4 tests).
Run: `npm test` → 136 tests. `npm run typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/github-auth-store.ts src/components/use-github-auth.ts test/github-auth-store.test.ts
git commit -m "feat: session GitHub auth store + hook"
```

---

### Task 4: Sign-in component + form integration

**Files:**
- Create: `src/components/github-sign-in.tsx`
- Modify: `src/app/score/page.tsx`

**Interfaces:**
- Consumes: Task 1's `requestDeviceCode`/`pollForToken`/`fetchAuthenticatedUser`; Task 3's store + `useGithubAuth`.
- Produces: `<GithubSignIn onVerified={(login) => …} />`.

- [ ] **Step 1: Create the component**

Create `src/components/github-sign-in.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import {
  fetchAuthenticatedUser,
  pollForToken,
  requestDeviceCode,
} from '@/lib/github-auth'
import { clearGithubAuth, setGithubAuth } from '@/lib/github-auth-store'
import { useGithubAuth } from '@/components/use-github-auth'

type UiState =
  | { step: 'idle' }
  | { step: 'starting' }
  | { step: 'code'; userCode: string; verificationUri: string }
  | { step: 'error'; message: string }

export function GithubSignIn({ onVerified }: { onVerified?: (login: string) => void }) {
  const auth = useGithubAuth()
  const [ui, setUi] = useState<UiState>({ step: 'idle' })
  const stopped = useRef(false)

  useEffect(() => {
    return () => {
      stopped.current = true
    }
  }, [])

  async function handleSignIn() {
    setUi({ step: 'starting' })
    stopped.current = false
    const requested = await requestDeviceCode()
    if (stopped.current) return
    if (requested.status === 'error') {
      setUi({ step: 'error', message: requested.reason })
      return
    }
    const { deviceCode, userCode, verificationUri, interval } = requested.code
    setUi({ step: 'code', userCode, verificationUri })
    const polled = await pollForToken(deviceCode, interval, {
      shouldStop: () => stopped.current,
    })
    if (stopped.current) return
    if (polled.status !== 'token') {
      const message =
        polled.status === 'denied'
          ? 'GitHub sign-in was denied.'
          : polled.status === 'expired'
            ? 'The code expired — try again.'
            : polled.status === 'cancelled'
              ? ''
              : polled.reason
      setUi(message ? { step: 'error', message } : { step: 'idle' })
      return
    }
    const user = await fetchAuthenticatedUser(polled.token)
    if (stopped.current) return
    if (user.status === 'error') {
      setUi({ step: 'error', message: user.reason })
      return
    }
    setGithubAuth({ token: polled.token, login: user.login })
    setUi({ step: 'idle' })
    onVerified?.(user.login)
  }

  function handleCancel() {
    stopped.current = true
    setUi({ step: 'idle' })
  }

  if (auth) {
    return (
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="text-emerald-400">✓ Signed in as @{auth.login}</span>
        <button onClick={() => clearGithubAuth()} className="underline">
          Sign out
        </button>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-zinc-400">
      {ui.step === 'idle' && (
        <button onClick={handleSignIn} className="self-start underline">
          Sign in with GitHub to verify your handle
        </button>
      )}
      {ui.step === 'starting' && <p>Contacting GitHub…</p>}
      {ui.step === 'code' && (
        <p>
          Enter code{' '}
          <span className="font-mono font-semibold text-zinc-200">{ui.userCode}</span> at{' '}
          <a
            href={ui.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 underline"
          >
            github.com/login/device
          </a>{' '}
          — waiting for approval…{' '}
          <button onClick={handleCancel} className="underline">
            cancel
          </button>
        </p>
      )}
      {ui.step === 'error' && (
        <p className="text-red-400">
          {ui.message}{' '}
          <button onClick={handleSignIn} className="underline">
            retry
          </button>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate into the form**

In `src/app/score/page.tsx`:

Add imports:

```tsx
import { GithubSignIn } from '@/components/github-sign-in'
import { useGithubAuth } from '@/components/use-github-auth'
```

Inside `ScoreForm`, add below the existing hooks:

```tsx
  const auth = useGithubAuth()
  // Prefill the handle from a verified session only while untouched — mirrors
  // the connected-wallet prefill.
  const githubTouched = useRef(githubInput !== '')

  useEffect(() => {
    if (!githubTouched.current && githubInput === '' && auth) {
      setGithubInput(auth.login)
    }
  }, [auth, githubInput])
```

Mark the github input as touched in its `onChange` (mirroring the wallet field):

```tsx
        onChange={(e) => {
          githubTouched.current = true
          setGithubInput(e.target.value)
        }}
```

And directly below the github-handle `<div>` (after its closing tag, before the submit button), add:

```tsx
      <GithubSignIn
        onVerified={(login) => {
          githubTouched.current = true
          setGithubInput(login)
        }}
      />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 136 tests. `npm run build` → exit 0, zero "Module not found".

- [ ] **Step 4: Commit**

```bash
git add src/components/github-sign-in.tsx src/app/score/page.tsx
git commit -m "feat: GitHub device-flow sign-in on the score form"
```

---

### Task 5: Authenticated gathering on results + verify pages

**Files:**
- Modify: `src/app/score/[wallet]/page.tsx`
- Modify: `src/app/verify/[uid]/page.tsx`

**Interfaces:**
- Consumes: `authorizedFetch` (Task 1), `useGithubAuth` (Task 3), `readGithubCredentials` from `@/lib/github` (existing: `(handle: string | null, fetchFn?: typeof fetch)`), `gatherInputs`' existing `fetchers` seam.

- [ ] **Step 1: Results page**

In `src/app/score/[wallet]/page.tsx`, add imports:

```tsx
import { readGithubCredentials } from '@/lib/github'
import { authorizedFetch } from '@/lib/github-auth'
import { useGithubAuth } from '@/components/use-github-auth'
```

Inside the component, add `const auth = useGithubAuth()` next to the other hooks. In the gather effect, replace

```tsx
        const gather = await gatherInputs(address, githubHandle, {}, (source) => {
```

with

```tsx
        // Signed-in sessions authenticate GitHub reads (5,000 req/hr vs 60).
        const fetchers = auth
          ? { github: (handle: string | null) => readGithubCredentials(handle, authorizedFetch(auth.token)) }
          : {}
        const gather = await gatherInputs(address, githubHandle, fetchers, (source) => {
```

and add `auth` to the effect's dependency array (`[wallet, githubHandle, attempt, router, auth]`).

- [ ] **Step 2: Verify page**

In `src/app/verify/[uid]/page.tsx`, add the same three imports and `const auth = useGithubAuth()`. Replace its

```tsx
        const gather = await gatherInputs(decoded.wallet, decoded.githubHandle)
```

with

```tsx
        const fetchers = auth
          ? { github: (handle: string | null) => readGithubCredentials(handle, authorizedFetch(auth.token)) }
          : {}
        const gather = await gatherInputs(decoded.wallet, decoded.githubHandle, fetchers)
```

and add `auth` to that effect's dependency array.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 136 tests. `npm run build` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/score/[wallet]/page.tsx' 'src/app/verify/[uid]/page.tsx'
git commit -m "feat: authenticated GitHub reads for signed-in sessions"
```

---

### Task 6: Attest verification gate + verified badge

**Files:**
- Modify: `src/components/attest-panel.tsx`
- Modify: `src/app/score/[wallet]/page.tsx` (badge on the address line)

**Interfaces:**
- Consumes: `useGithubAuth` (Task 3).

- [ ] **Step 1: Attest gate**

In `src/components/attest-panel.tsx`, add the import:

```tsx
import { useGithubAuth } from '@/components/use-github-auth'
```

Inside `AttestPanel`, add `const auth = useGithubAuth()` beside the other hooks, and directly after the existing incomplete-data early return, add:

```tsx
  // Integrity gate: a handle-bearing attestation requires the signed-in
  // GitHub user to be that handle. Handle-less attestations are unrestricted.
  const handleVerified =
    scored.githubHandle === null ||
    (auth !== null && auth.login.toLowerCase() === scored.githubHandle.toLowerCase())
  if (!handleVerified) {
    return (
      <p className="text-xs text-amber-500">
        This score includes the GitHub handle @{scored.githubHandle}, which hasn&apos;t been
        verified. Sign in with GitHub on the form screen (Edit inputs) to prove it&apos;s yours
        before attesting.
      </p>
    )
  }
```

- [ ] **Step 2: Verified badge on results**

In `src/app/score/[wallet]/page.tsx` (which already has `useGithubAuth` from Task 5), change the address line

```tsx
          <p className="break-all font-mono text-xs text-zinc-500">
            {state.scored.address}
            {state.scored.githubHandle && ` · @${state.scored.githubHandle}`}
          </p>
```

to

```tsx
          <p className="break-all font-mono text-xs text-zinc-500">
            {state.scored.address}
            {state.scored.githubHandle && ` · @${state.scored.githubHandle}`}
            {state.scored.githubHandle &&
              auth?.login.toLowerCase() === state.scored.githubHandle.toLowerCase() && (
                <span className="text-emerald-400"> · verified</span>
              )}
          </p>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0. `npm test` → 136 tests. `npm run build` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/attest-panel.tsx 'src/app/score/[wallet]/page.tsx'
git commit -m "feat: verified-handle attest gate and results badge"
```

---

## Post-plan validation (coordinator, not a task)

Browser pass with the real OAuth app: sign in from `/score` (device code appears, approve on github.com, chip shows "✓ Signed in as @…"), handle prefills; results for wallet+verified-handle show "· verified" and an enabled attest panel; results with a mismatched handle show the amber gate; sign out restores the unauthenticated path.
