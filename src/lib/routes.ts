// Route builders shared by the input and results screens, so the URL shape
// lives in exactly one place. Pure module: no imports, no framework.

export function scorePath(wallet: string, github: string | null): string {
  const base = `/score/${wallet}`
  const handle = github?.trim() ?? ''
  return handle ? `${base}?github=${encodeURIComponent(handle)}` : base
}

export function inputPath(wallet: string | null = null, github: string | null = null): string {
  const params = new URLSearchParams()
  const addr = wallet?.trim() ?? ''
  const handle = github?.trim() ?? ''
  if (addr) params.set('wallet', addr)
  if (handle) params.set('github', handle)
  const query = params.toString()
  return query ? `/score?${query}` : '/score'
}

export function verifyPath(uid: string | null = null): string {
  return uid ? `/verify/${uid}` : '/verify'
}
