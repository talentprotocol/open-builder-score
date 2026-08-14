import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SITE_ORIGIN, dataOptOutPath } from '@/lib/routes'

// optout.talentprotocol.com points at this same Vercel project as every
// other host (the *.vercel.app domains, preview deployments, localhost),
// but it must only ever serve the data-transfer opt-out flow — not the rest
// of the Open Builder Score product living behind it. Everything else on
// that one host redirects to the main site instead. No other host is
// touched by this file.
const OPT_OUT_HOST = 'optout.talentprotocol.com'

// The bare root is the one path someone who only half-remembers this domain
// is likely to type directly. Bouncing that straight off to the main site
// would send them away from the exact thing this domain exists for, so it
// gets its own redirect, to the form itself, staying on this host — an
// absolute URL (not one resolved against the request, which in some
// environments doesn't reflect the Host header any better than `nextUrl`
// does — see `normalizedHost` below) so the target is the same in every
// environment. `dataOptOutPath()` is itself in `OPT_OUT_ALLOWED_PATHS`
// below, so this can never redirect into another redirect.
const OPT_OUT_ROOT_REDIRECT = `https://${OPT_OUT_HOST}${dataOptOutPath()}`

// Reachable on the opt-out host: the opt-out pages themselves, the API
// routes those pages call, and the static assets Next.js needs to render
// them (JS/CSS chunks and the image optimizer under `/_next`, plus the app
// icon used as the page favicon). Matched as exact paths or `/prefix/...`
// subpaths — never as a bare substring — so this can't accidentally widen
// to something unrelated.
const OPT_OUT_ALLOWED_PATHS = ['/data-opt-out', '/api/opt-out', '/_next', '/favicon.ico', '/icon.png']

function isAllowedOnOptOutHost(pathname: string): boolean {
  return OPT_OUT_ALLOWED_PATHS.some((allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`))
}

// Read straight off the `Host` request header rather than
// `request.nextUrl.hostname`: outside of a real Vercel deployment (`next
// dev`, or `next start` without `experimental.trustHostHeader`), Next.js
// builds `nextUrl` from the server's own bind address, not the incoming
// Host header, so it can't see per-domain requests at all. The header itself
// is untouched by that and is what Vercel's routing sets to the domain the
// visitor actually requested. Normalized by hand — lowercased, port
// stripped — since header values carry neither guarantee.
function normalizedHost(request: NextRequest): string {
  const host = request.headers.get('host') ?? ''
  return host.split(':')[0].toLowerCase()
}

export function proxy(request: NextRequest): NextResponse {
  // Compared for exact equality (not e.g. `.includes`) so an unrelated host
  // that merely contains "optout" can't match.
  if (normalizedHost(request) !== OPT_OUT_HOST) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  if (isAllowedOnOptOutHost(pathname)) {
    return NextResponse.next()
  }

  // 307, not 308, on both of the redirects below: temporary, so browsers
  // never cache either one past a change in the domain's routing.
  if (pathname === '/') {
    return NextResponse.redirect(OPT_OUT_ROOT_REDIRECT, 307)
  }

  return NextResponse.redirect(SITE_ORIGIN, 307)
}
