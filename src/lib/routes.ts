// Route builders shared by the input and results screens, so the URL shape
// lives in exactly one place. Pure module: no imports, no framework.

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
