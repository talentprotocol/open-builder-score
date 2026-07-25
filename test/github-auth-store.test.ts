import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  } as Storage
}

beforeEach(() => {
  vi.resetModules()
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  vi.stubGlobal('window', {
    sessionStorage: makeStorage(),
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(cb)
    },
    removeEventListener: (type: string, cb: (e: unknown) => void) => {
      listeners.get(type)?.delete(cb)
    },
    dispatchEvent: (event: { type: string }) => {
      listeners.get(event.type)?.forEach((cb) => cb(event))
      return true
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function store() {
  return await import('@/lib/github-auth-store')
}

describe('github auth store', () => {
  it('round-trips set/get/clear', async () => {
    const s = await store()
    expect(s.getGithubAuth()).toBeNull()
    s.setGithubAuth({ token: 'tok', login: 'octocat' })
    expect(s.getGithubAuth()).toEqual({ token: 'tok', login: 'octocat' })
    s.clearGithubAuth()
    expect(s.getGithubAuth()).toBeNull()
  })
  it('returns a referentially stable snapshot between writes', async () => {
    const s = await store()
    s.setGithubAuth({ token: 'tok', login: 'octocat' })
    expect(s.getGithubAuth()).toBe(s.getGithubAuth())
  })
  it('notifies subscribers on set and clear', async () => {
    const s = await store()
    let calls = 0
    const unsubscribe = s.subscribeGithubAuth(() => calls++)
    s.setGithubAuth({ token: 'tok', login: 'octocat' })
    s.clearGithubAuth()
    unsubscribe()
    s.setGithubAuth({ token: 'tok2', login: 'octocat' })
    expect(calls).toBe(2)
  })
  it('tolerates junk in storage', async () => {
    const s = await store()
    window.sessionStorage.setItem('obs-github-auth', 'not json')
    expect(s.getGithubAuth()).toBeNull()
  })
})
