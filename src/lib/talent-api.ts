// Server-only access to talent-api, the legacy Talent Protocol backend. Never
// imported by a client component — it reads TALENT_API_KEY.
//
// Talent Protocol is shutting down; the data-transfer opt-out flow lets a
// builder ask that their data not carry over to the successor company.
// talent-api already implements it end to end (POST /data_transfer_opt_outs,
// /data_transfer_opt_outs/confirm, GET /data_transfer_opt_outs/status); this
// app only proxies to it (src/app/api/opt-out/*) because every talent-api
// request requires an X-API-KEY header the browser must never see.

export function talentApiKey(): string | null {
  const key = process.env.TALENT_API_KEY
  return typeof key === 'string' && key !== '' ? key : null
}

export function talentApiUrl(): string {
  const url = process.env.TALENT_API_URL
  return typeof url === 'string' && url !== '' ? url : 'https://api.talentprotocol.com'
}

// The proxy routes call talent-api from this app's shared Vercel egress IPs,
// which would collapse talent-api's per-visitor rate limiting onto whichever
// deployment happens to be handling traffic. Vercel prepends the connecting
// client's address as the first entry of x-forwarded-for on every request
// that reaches this app, so forward that (and only that) on as X-Client-IP —
// the header talent-api's limiter now keys on — letting it rate-limit per
// visitor again. Never logged: callers must not pass this to a logger.
export function visitorIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (!forwardedFor) return null
  const firstHop = forwardedFor.split(',')[0]?.trim() ?? ''
  return firstHop !== '' ? firstHop : null
}
