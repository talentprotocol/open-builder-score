'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { claimGithubSession, ERROR_PARAM, signInHref } from '@/lib/github-auth'
import { clearGithubAuth, setGithubAuth } from '@/lib/github-auth-store'
import { useGithubAuth } from '@/components/use-github-auth'
import { Badge } from '@/components/ui/badge'

export function GithubSignIn({
  onVerified,
  returnTo,
}: {
  onVerified?: (login: string) => void
  /**
   * Sign-in is a top-level navigation to github.com and back, so any in-page
   * state the caller wants to survive the round-trip must be encoded in this
   * URL — the default (current pathname + query) only preserves what was
   * already in the address bar when the page loaded, not what the user typed
   * since.
   */
  returnTo?: string
}) {
  const auth = useGithubAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [claimError, setClaimError] = useState<string | null>(null)
  // The claim clears its cookie, so it must happen exactly once even though
  // React mounts effects twice in development.
  const claimed = useRef(false)

  // Captured during the first render, not inside the effect below: that effect
  // strips the param from the URL, which would otherwise erase the message
  // before it has been read.
  const [reportedError] = useState(() => searchParams.get(ERROR_PARAM))

  useEffect(() => {
    if (claimed.current) return
    claimed.current = true
    let cancelled = false
    ;(async () => {
      const session = await claimGithubSession()
      if (cancelled) return
      if (session.status === 'ok') {
        setGithubAuth({ token: session.token, login: session.login })
        onVerified?.(session.login)
      } else if (session.status === 'error') {
        setClaimError(session.reason)
      }
    })()
    return () => {
      cancelled = true
    }
    // onVerified is a fresh closure each render; re-running on it would claim
    // a cookie that is already spent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Strip the error out of the URL once it has been captured, so a reload or a
  // shared link doesn't resurrect a stale failure.
  useEffect(() => {
    if (!reportedError) return
    const next = new URLSearchParams(window.location.search)
    next.delete(ERROR_PARAM)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [reportedError, pathname, router])

  const error = claimError ?? reportedError

  // Never round-trip a stale error through sign-in.
  const params = new URLSearchParams(searchParams)
  params.delete(ERROR_PARAM)
  const target = returnTo ?? `${pathname}${params.toString() ? `?${params}` : ''}`

  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <motion.div
        key={auth ? 'chip' : 'signed-out'}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {auth ? (
          <p className="flex items-center gap-2">
            <Badge variant="success" className="text-sm">
              ✓ Signed in as @{auth.login}
            </Badge>
            <button type="button" onClick={() => clearGithubAuth()} className="underline">
              Sign out
            </button>
          </p>
        ) : (
          // A plain link, not a fetch: this is a top-level navigation to
          // github.com and back, so there is no in-page state to keep alive
          // and nothing to poll.
          <a href={signInHref(target)} className="self-start underline">
            Sign in with GitHub to verify your handle
          </a>
        )}
      </motion.div>
      {error && <p className="text-destructive-text">{error}</p>}
    </div>
  )
}
