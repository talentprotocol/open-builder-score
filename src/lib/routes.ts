// Route builders shared by the input and results screens, so the URL shape
// lives in exactly one place. Pure module: no imports, no framework.

// Hardcoded, not read from the environment. These URLs outlive the deployment
// that produced them — a shared link, an OG tag, and above all the schema
// description written onchain, which cannot be edited. Deriving the origin from
// window.location or a Vercel env var would mint links pointing at a preview
// deployment that stops resolving.
export const SITE_ORIGIN = 'https://talentprotocol.com'

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

function cleanExtras(extras: string[]): string[] {
  return extras.map((e) => e.trim()).filter((e) => e !== '')
}

export function scorePath(wallet: string, github: string | null, extras: string[] = []): string {
  const parts: string[] = []
  const handle = github?.trim() ?? ''
  if (handle) parts.push(`github=${encodeURIComponent(handle)}`)
  const list = cleanExtras(extras)
  // Commas are legal raw in query values; keep the shareable URL readable.
  if (list.length > 0) parts.push(`wallets=${list.map(encodeURIComponent).join(',')}`)
  return parts.length > 0 ? `/score/${wallet}?${parts.join('&')}` : `/score/${wallet}`
}

export function inputPath(
  wallet: string | null = null,
  github: string | null = null,
  extras: string[] = [],
): string {
  const params = new URLSearchParams()
  const addr = wallet?.trim() ?? ''
  const handle = github?.trim() ?? ''
  if (addr) params.set('wallet', addr)
  if (handle) params.set('github', handle)
  const list = cleanExtras(extras)
  if (list.length > 0) params.set('wallets', list.join(','))
  const query = params.toString()
  return query ? `/score?${query}` : '/score'
}

export function verifyPath(uid: string | null = null): string {
  return uid ? `/verify/${uid}` : '/verify'
}

// Resolves to that wallet's most recent attestation. This is what an attestation
// points at, because it cannot point at itself: EAS hashes both the record's own
// data and block.timestamp into the UID, so the UID is neither knowable nor
// self-containable before the transaction is mined.
export function verifyWalletPath(wallet: string): string {
  return `/verify/wallet/${wallet}`
}

export function attestationsPath(): string {
  return '/attestations'
}

export function credentialsPath(slug: string | null = null): string {
  return slug ? `/credentials#${slug}` : '/credentials'
}

// Badges get their own page rather than a section of the credential
// reference: they carry no points, so filing them under the document that
// explains where points come from misstates what they are.
export function badgesPath(slug: string | null = null): string {
  return slug ? `/badges#${slug}` : '/badges'
}

// Data-transfer opt-out (temporary, Talent Protocol shutdown): the landing
// page where a builder enters their email, and the token-keyed page a
// confirmation email links to.
export function dataOptOutPath(): string {
  return '/data-opt-out'
}

export function dataOptOutConfirmPath(token: string): string {
  return `/data-opt-out/confirm/${encodeURIComponent(token)}`
}

export function termsPath(): string {
  return '/terms'
}

export function privacyPath(): string {
  return '/privacy'
}
