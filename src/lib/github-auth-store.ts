// Session-scoped GitHub auth (zero-scope token + verified login).
// sessionStorage-backed with a module-level snapshot cache so getGithubAuth
// is referentially stable — required by useSyncExternalStore.

const STORAGE_KEY = 'obs-github-auth'
const CHANGE_EVENT = 'obs-github-auth-changed'

export interface GithubAuth {
  token: string
  login: string
}

// undefined = not yet read; null = known absent.
let cached: GithubAuth | null | undefined

function readStorage(): GithubAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.token !== 'string' || typeof parsed.login !== 'string') return null
    return { token: parsed.token, login: parsed.login }
  } catch {
    return null
  }
}

export function getGithubAuth(): GithubAuth | null {
  if (cached === undefined) cached = readStorage()
  return cached
}

function notify(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function setGithubAuth(auth: GithubAuth): void {
  cached = auth
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
  } catch {
    // Storage unavailable: in-memory cache still works for this page.
  }
  notify()
}

export function clearGithubAuth(): void {
  cached = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to remove.
  }
  notify()
}

export function subscribeGithubAuth(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: Event) => {
    // Another tab changed sessionStorage: drop the cache and re-read.
    if ((event as StorageEvent).key === STORAGE_KEY || (event as StorageEvent).key === undefined) {
      cached = undefined
    }
    callback()
  }
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}
