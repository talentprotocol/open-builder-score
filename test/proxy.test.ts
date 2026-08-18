import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const OPT_OUT_HOST = 'optout.talentprotocol.com'
const OTHER_HOSTS = ['the-final-app.vercel.app', 'localhost:3000']

// The request line's own URL is irrelevant to proxy's host check — it reads
// the `Host` header instead (see proxy.ts for why) — so the URL here is a
// fixed placeholder and only the header carries the host under test, same
// as a real request: one physical listener, many possible Host headers.
function request(host: string, path: string): NextRequest {
  return new NextRequest(`http://placeholder.invalid${path}`, { headers: { host } })
}

function expectPassThrough(host: string, path: string): void {
  const response = proxy(request(host, path))
  // NextResponse.next() carries this header as its signal to continue
  // routing instead of responding directly — the most direct way to assert
  // "unchanged" without depending on internal response shape.
  expect(response.headers.get('x-middleware-next')).toBe('1')
}

function expectRedirectToMainSite(host: string, path: string): void {
  const response = proxy(request(host, path))
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe('https://talentprotocol.com/')
}

function expectRedirectToOptOutForm(host: string, path: string): void {
  const response = proxy(request(host, path))
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe(`https://${OPT_OUT_HOST}/data-opt-out`)
}

describe('proxy on the opt-out host', () => {
  it('passes through /data-opt-out', () => {
    expectPassThrough(OPT_OUT_HOST, '/data-opt-out')
  })

  it('passes through /data-opt-out/confirm/<token>', () => {
    expectPassThrough(OPT_OUT_HOST, '/data-opt-out/confirm/abc123')
  })

  it('passes through /api/opt-out/request', () => {
    expectPassThrough(OPT_OUT_HOST, '/api/opt-out/request')
  })

  it('passes through /_next/static/... assets', () => {
    expectPassThrough(OPT_OUT_HOST, '/_next/static/chunks/main.js')
  })

  it('redirects / to the opt-out form on the same host with a 307, not off to the main site', () => {
    expectRedirectToOptOutForm(OPT_OUT_HOST, '/')
  })

  it('cannot loop: the target of the / redirect passes through rather than redirecting again', () => {
    const rootResponse = proxy(request(OPT_OUT_HOST, '/'))
    const location = rootResponse.headers.get('location')
    expect(location).not.toBeNull()
    const landingPath = new URL(location!).pathname
    expectPassThrough(OPT_OUT_HOST, landingPath)
  })

  it('redirects /badges with a 307', () => {
    expectRedirectToMainSite(OPT_OUT_HOST, '/badges')
  })

  it('redirects /api/github/session with a 307 — the OBS API must not be exposed on this host', () => {
    expectRedirectToMainSite(OPT_OUT_HOST, '/api/github/session')
  })

  it('does not treat a lookalike path as allowed (no bare-substring matching)', () => {
    expectRedirectToMainSite(OPT_OUT_HOST, '/data-opt-out-evil')
  })

  it.each(['OPTOUT.TALENTPROTOCOL.COM', 'OptOut.TalentProtocol.Com'])(
    'matches the host case-insensitively (%s)',
    (host) => {
      expectRedirectToMainSite(host, '/badges')
      expectPassThrough(host, '/data-opt-out')
    },
  )

  it('ignores a port suffix on the host', () => {
    expectRedirectToMainSite(`${OPT_OUT_HOST}:443`, '/badges')
    expectPassThrough(`${OPT_OUT_HOST}:443`, '/data-opt-out')
  })
})

describe('proxy on any other host', () => {
  it.each(OTHER_HOSTS)('passes through /badges unchanged (%s)', (host) => {
    expectPassThrough(host, '/badges')
  })

  it.each(OTHER_HOSTS)('passes through /data-opt-out unchanged (%s)', (host) => {
    expectPassThrough(host, '/data-opt-out')
  })

  it('does not match on a substring of the opt-out host', () => {
    // Hostnames containing "optout" that are not the exact opt-out host —
    // the host check must not degrade to `.includes('optout')`.
    expectPassThrough('optout.evil.example.com', '/badges')
    expectPassThrough('notoptout.talentprotocol.com', '/badges')
  })
})
