// Shared body of the two device-flow passthroughs. Not a route file, so Next
// leaves it alone.
//
// GitHub does not always answer with JSON: rate limiting, abuse detection and
// maintenance all return HTML. A bare `upstream.json()` throws on those and
// Next turns the throw into a 500 HTML page, which reaches the browser as an
// opaque "sign-in failed (500)". Relaying a structured 502 instead keeps the
// real cause visible.
const UPSTREAM_TIMEOUT_MS = 10_000

function unavailable(description: string): Response {
  return Response.json(
    { error: 'upstream_unavailable', error_description: description },
    { status: 502 },
  )
}

export async function relay(url: string, body: Record<string, string>): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return unavailable('GitHub is unreachable or timed out.')
  }
  let payload: unknown
  try {
    payload = await upstream.json()
  } catch {
    return unavailable(`GitHub returned a non-JSON response (${upstream.status}).`)
  }
  return Response.json(payload, { status: upstream.status })
}
