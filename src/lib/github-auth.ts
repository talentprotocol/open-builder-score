// GitHub OAuth device flow (zero scopes). The client ID is a public
// identifier — same precedent as the WalletConnect projectId — so it ships
// committed and nothing needs configuring to run the app. The env override
// exists only so the app can be pointed at a different GitHub app without a
// code change; there is no secret and no redirect URI in this flow.
export const GITHUB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || 'Ov23lifhhYZia6r3ZYv3'

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

// GitHub answers these with HTTP 200 and an error body, so without this map
// a misconfigured app reads as "unexpected shape" and nothing else.
const DEVICE_FLOW_ERRORS: Record<string, string> = {
  device_flow_disabled: 'This GitHub app doesn’t have device flow enabled.',
  incorrect_client_credentials: 'GitHub rejected the app’s client ID.',
  unverified_user_email: 'Verify your primary email address on GitHub, then try again.',
}

// Null when the body carries no `error` — the caller then falls through to its
// own shape/status handling.
function describeGithubError(raw: Record<string, unknown>): string | null {
  if (typeof raw.error !== 'string') return null
  const known = DEVICE_FLOW_ERRORS[raw.error]
  if (known) return known
  if (typeof raw.error_description === 'string') return raw.error_description
  return `GitHub said: ${raw.error}`
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function requestDeviceCode(fetchFn: typeof fetch = fetch): Promise<DeviceCodeResult> {
  try {
    const response = await fetchFn(DEVICE_CODE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID }),
    })
    const raw = await readJson(response)
    // Checked before the status, because GitHub reports device_flow_disabled
    // and friends with a 200.
    const described = raw && describeGithubError(raw)
    if (described) return { status: 'error', reason: described }
    if (!response.ok || raw === null) {
      return { status: 'error', reason: `GitHub sign-in failed (${response.status})` }
    }
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
      const raw = await readJson(response)
      if (raw === null) {
        return { status: 'error', reason: `GitHub sign-in failed (${response.status})` }
      }
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
          return {
            status: 'error',
            reason: describeGithubError(raw) ?? 'GitHub returned an unexpected shape',
          }
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
