// Host policy for optout.talentprotocol.com.
//
// optout.talentprotocol.com points at this same Vercel project as every
// other host (the *.vercel.app domains, preview deployments, localhost),
// but it must only ever serve the data-transfer opt-out flow — not the rest
// of the Builder Score product living behind it. Everything else on that one
// host redirects to the main site instead. No other host is touched.
//
// This module is the single source of truth for that policy. It is consumed
// twice: `next.config.ts` turns it into `redirects()` rules, and the tests
// check the two representations below still describe the same split.
//
// The rules deliberately live in `next.config.ts` rather than in middleware.
// Config redirects compile into the deployment's routing table and are
// evaluated by Vercel's edge router; middleware is a Node.js function that
// Vercel bills as Fluid Active CPU and — with no `matcher` — was invoked on
// *every* request to a site that is otherwise 100% static and CDN-cached.
// In production that was ~28K invocations a day, every one of them merely
// returning `next()`, and it was the single largest consumer of the
// account's Fluid CPU allowance. The routing table does the same job for
// free. Pure module: no imports, no framework.
export const OPT_OUT_HOST = 'optout.talentprotocol.com'

// Reachable on the opt-out host: the opt-out pages themselves, the API
// routes those pages call, and the static assets Next.js needs to render
// them (JS/CSS chunks and the image optimizer under `/_next`, plus the app
// icon used as the page favicon). Matched as exact paths or `/prefix/...`
// subpaths — never as a bare substring — so this can't accidentally widen
// to something unrelated.
export const OPT_OUT_ALLOWED_PATHS = [
  '/data-opt-out',
  '/api/opt-out',
  '/_next',
  '/favicon.ico',
  '/icon.png',
]

export function isAllowedOnOptOutHost(pathname: string): boolean {
  return OPT_OUT_ALLOWED_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  )
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The same split as `isAllowedOnOptOutHost`, expressed as the path pattern
// Next.js compiles into a routing rule: everything the allowlist does *not*
// cover. Each alternative is anchored with `(?:/|$)` rather than left as a
// bare prefix so `/data-opt-out-evil` stays blocked — a bare `(?!data-opt-out)`
// would wave through any path that merely starts with an allowed one.
// `.` is escaped because `favicon.ico` and `icon.png` are literals here, not
// single-character wildcards.
const ALLOWED_LOOKAHEAD = OPT_OUT_ALLOWED_PATHS.map(
  (allowed) => `${escapeRegExp(allowed.slice(1))}(?:/|$)`,
).join('|')

export const OPT_OUT_BLOCKED_SOURCE = `/:path((?!${ALLOWED_LOOKAHEAD}).*)`

// The compiled form of `OPT_OUT_BLOCKED_SOURCE`, for the test that checks it
// against `isAllowedOnOptOutHost` on a table of real paths. Next.js compiles
// `source` with its own vendored path-to-regexp, so this is a stand-in for
// that step, not the step itself — it proves the *pattern* describes the
// intended split, and the curl check in the PR notes covers the wiring.
export const OPT_OUT_BLOCKED_REGEXP = new RegExp(`^/(?!${ALLOWED_LOOKAHEAD}).*$`)
