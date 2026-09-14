import { describe, it, expect } from 'vitest'
import nextConfig from '../next.config'
import {
  OPT_OUT_BLOCKED_REGEXP,
  OPT_OUT_HOST,
  isAllowedOnOptOutHost,
} from '@/lib/opt-out-host'
import { SITE_ORIGIN } from '@/lib/routes'

// The policy this file guards used to live in middleware, where it could be
// tested by calling a function with a request. It is now a pair of routing
// rules Vercel evaluates before any of our code runs, so there is no function
// to call. What is still ours to get wrong is the *split* — which paths the
// rules leave alone on the opt-out host and which they send away — so that is
// what these tests pin, from both directions: the predicate and the path
// pattern derived from it must agree on every path below.

const PASSES_THROUGH = [
  '/data-opt-out',
  '/data-opt-out/confirm/abc123',
  '/api/opt-out/request',
  '/api/opt-out/status',
  '/_next/static/chunks/main.js',
  '/_next/image',
  '/favicon.ico',
  '/icon.png',
]

const REDIRECTS_AWAY = [
  '/badges',
  '/credentials',
  '/score/0x1234',
  '/verify/wallet/0x1234',
  '/terms',
  // The OBS API must not be exposed on this host.
  '/api/github/session',
  // A lookalike path is not an allowed one: the allowlist matches exact paths
  // and `/prefix/...` subpaths, never a bare substring or a bare prefix.
  '/data-opt-out-evil',
  '/api/opt-out-evil',
  '/_nextdoor',
  '/icon.png.exe',
]

async function redirectRules() {
  return (await nextConfig.redirects!()).filter((rule) =>
    rule.has?.some((condition) => condition.type === 'host' && condition.value === OPT_OUT_HOST),
  )
}

describe('the opt-out host allowlist', () => {
  it.each(PASSES_THROUGH)('allows %s', (pathname) => {
    expect(isAllowedOnOptOutHost(pathname)).toBe(true)
  })

  it.each(REDIRECTS_AWAY)('does not allow %s', (pathname) => {
    expect(isAllowedOnOptOutHost(pathname)).toBe(false)
  })
})

describe('the path pattern derived from that allowlist', () => {
  it.each(PASSES_THROUGH)('does not match %s, so no rule fires for it', (pathname) => {
    expect(OPT_OUT_BLOCKED_REGEXP.test(pathname)).toBe(false)
  })

  it.each(REDIRECTS_AWAY)('matches %s', (pathname) => {
    expect(OPT_OUT_BLOCKED_REGEXP.test(pathname)).toBe(true)
  })

  it.each([...PASSES_THROUGH, ...REDIRECTS_AWAY])(
    'agrees with the predicate on %s',
    (pathname) => {
      expect(OPT_OUT_BLOCKED_REGEXP.test(pathname)).toBe(!isAllowedOnOptOutHost(pathname))
    },
  )
})

describe('the redirect rules in next.config', () => {
  it('scopes every rule to the opt-out host, so no other host is touched', async () => {
    const all = await nextConfig.redirects!()
    expect(all).toHaveLength((await redirectRules()).length)
    expect(all.length).toBeGreaterThan(0)
  })

  it('sends the bare root to the opt-out form on the same host', async () => {
    const root = (await redirectRules()).find((rule) => rule.source === '/')
    expect(root?.destination).toBe(`https://${OPT_OUT_HOST}/data-opt-out`)
  })

  it('checks the root before the catch-all, which would otherwise swallow it', async () => {
    const rules = await redirectRules()
    const root = rules.findIndex((rule) => rule.source === '/')
    const catchAll = rules.findIndex((rule) => rule.source !== '/')
    expect(root).toBeGreaterThanOrEqual(0)
    expect(catchAll).toBeGreaterThan(root)
  })

  it('cannot loop: the root redirect lands on a path the catch-all leaves alone', async () => {
    const root = (await redirectRules()).find((rule) => rule.source === '/')
    const landing = new URL(root!.destination).pathname
    expect(isAllowedOnOptOutHost(landing)).toBe(true)
  })

  it('sends everything else to the main site', async () => {
    const catchAll = (await redirectRules()).find((rule) => rule.source !== '/')
    expect(catchAll?.destination).toBe(SITE_ORIGIN)
  })

  it('redirects temporarily (307), so a routing change is never cached', async () => {
    for (const rule of await redirectRules()) {
      expect(rule.permanent).toBe(false)
    }
  })
})
