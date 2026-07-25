'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  fetchAuthenticatedUser,
  pollForToken,
  requestDeviceCode,
} from '@/lib/github-auth'
import { clearGithubAuth, setGithubAuth } from '@/lib/github-auth-store'
import { useGithubAuth } from '@/components/use-github-auth'

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
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={auth ? 'chip' : ui.step}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18 }}
      >
        {auth ? (
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="text-emerald-400">✓ Signed in as @{auth.login}</span>
            <button onClick={() => clearGithubAuth()} className="underline">
              Sign out
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-1 text-xs text-zinc-400">
            {ui.step === 'idle' && (
              <button onClick={handleSignIn} className="self-start underline">
                Sign in with GitHub to verify your handle
              </button>
            )}
            {ui.step === 'starting' && <p>Contacting GitHub…</p>}
            {ui.step === 'code' && (
              <p>
                Enter code{' '}
                <span className="font-mono font-semibold text-zinc-200">{ui.userCode}</span> at{' '}
                <a
                  href={ui.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline"
                >
                  github.com/login/device
                </a>{' '}
                — waiting for approval…{' '}
                <button onClick={handleCancel} className="underline">
                  cancel
                </button>
              </p>
            )}
            {ui.step === 'error' && (
              <p className="text-red-400">
                {ui.message}{' '}
                <button onClick={handleSignIn} className="underline">
                  retry
                </button>
              </p>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
