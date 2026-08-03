'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  fetchAuthenticatedUser,
  pollForToken,
  requestDeviceCode,
} from '@/lib/github-auth'
import { clearGithubAuth, setGithubAuth } from '@/lib/github-auth-store'
import { useGithubAuth } from '@/components/use-github-auth'
import { Badge } from '@/components/ui/badge'

type UiState =
  | { step: 'idle' }
  | { step: 'starting' }
  | { step: 'code'; userCode: string; verificationUri: string }
  | { step: 'error'; message: string }

export function GithubSignIn({ onVerified }: { onVerified?: (login: string) => void }) {
  const auth = useGithubAuth()
  const [ui, setUi] = useState<UiState>({ step: 'idle' })
  const stopped = useRef(false)

  useEffect(() => {
    return () => {
      stopped.current = true
    }
  }, [])

  async function handleSignIn() {
    setUi({ step: 'starting' })
    stopped.current = false
    const requested = await requestDeviceCode()
    if (stopped.current) return
    if (requested.status === 'error') {
      setUi({ step: 'error', message: requested.reason })
      return
    }
    const { deviceCode, userCode, verificationUri, interval } = requested.code
    setUi({ step: 'code', userCode, verificationUri })
    const polled = await pollForToken(deviceCode, interval, {
      shouldStop: () => stopped.current,
    })
    if (stopped.current) return
    if (polled.status !== 'token') {
      const message =
        polled.status === 'denied'
          ? 'GitHub sign-in was denied.'
          : polled.status === 'expired'
            ? 'The code expired — try again.'
            : polled.status === 'cancelled'
              ? ''
              : polled.reason
      setUi(message ? { step: 'error', message } : { step: 'idle' })
      return
    }
    const user = await fetchAuthenticatedUser(polled.token)
    if (stopped.current) return
    if (user.status === 'error') {
      setUi({ step: 'error', message: user.reason })
      return
    }
    setGithubAuth({ token: polled.token, login: user.login })
    setUi({ step: 'idle' })
    onVerified?.(user.login)
  }

  function handleCancel() {
    stopped.current = true
    setUi({ step: 'idle' })
  }

  return (
    // Deliberately not wrapped in AnimatePresence. With `mode="wait"` it held
    // the outgoing state mounted until its exit animation reported completion,
    // and an exit that never runs strands the user: the idle "Sign in" link
    // stays on screen while the device code sits unrendered and polling ticks
    // away invisibly. Animations pause in a backgrounded tab — and this flow
    // sends you to github.com/login/device, so backgrounding is the normal
    // path. A keyed motion.div still fades each state in on mount; nothing in
    // the state machine now waits on an animation to advance.
    <div>
      <motion.div
        key={auth ? 'chip' : ui.step}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {auth ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="success" className="text-sm">
              ✓ Signed in as @{auth.login}
            </Badge>
            <button type="button" onClick={() => clearGithubAuth()} className="underline">
              Sign out
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {ui.step === 'idle' && (
              <button type="button" onClick={handleSignIn} className="self-start underline">
                Sign in with GitHub to verify your handle
              </button>
            )}
            {ui.step === 'starting' && <p>Contacting GitHub…</p>}
            {ui.step === 'code' && (
              <p>
                Enter code{' '}
                <span className="font-mono font-semibold text-foreground">{ui.userCode}</span> at{' '}
                <a
                  href={ui.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-success-text underline"
                >
                  github.com/login/device
                </a>{' '}
                — waiting for approval…{' '}
                <button type="button" onClick={handleCancel} className="underline">
                  cancel
                </button>
              </p>
            )}
            {ui.step === 'error' && (
              <p className="text-destructive-text">
                {ui.message}{' '}
                <button type="button" onClick={handleSignIn} className="underline">
                  retry
                </button>
              </p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
