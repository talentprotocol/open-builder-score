'use client'

import { useState } from 'react'
import { isLikelyEmail, requestOptOut, type RequestOptOutResult } from '@/lib/opt-out'
import { FadeRise } from '@/components/motion/fade-rise'
import { PingDot } from '@/components/motion/ping-dot'
import { Button } from '@/components/ui/button'

export default function DataOptOutPage() {
  const [emailInput, setEmailInput] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<RequestOptOutResult | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const email = emailInput.trim()
    if (!isLikelyEmail(email)) {
      setValidationError('That doesn’t look like a valid email address.')
      setResult(null)
      return
    }
    setValidationError(null)
    setPending(true)
    const outcome = await requestOptOut(email)
    setPending(false)
    setResult(outcome)
  }

  // Enumeration-neutral by design: talent-api returns the same 200 whether or
  // not the email matched an account, and this page can't say more than the
  // response does — see the request proxy route for why.
  if (result?.status === 'sent') {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col">
        <FadeRise>
          <div
            role="status"
            className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success/10 p-4"
          >
            <h1 className="text-base font-medium text-success-text">Check your inbox</h1>
            <p className="text-sm text-muted-foreground">
              If that email belongs to a Talent Protocol account, we&apos;ve sent a confirmation
              link. Check your inbox.
            </p>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="self-start text-sm text-muted-foreground underline hover:text-foreground"
            >
              Use a different email
            </button>
          </div>
        </FadeRise>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col">
      <FadeRise className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-normal">Opt out of the data transfer</h1>
          <p className="text-base text-muted-foreground">
            Talent Protocol is shutting down. Unless you opt out, your profile data will be
            transferred to the company continuing the service. Opting out means your data will
            not be transferred. Enter the email linked to your account and we&apos;ll send you a
            confirmation link.
          </p>
        </header>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-base transition-shadow focus:outline-none focus:ring-1 focus:ring-success/60 focus:shadow-[0_0_18px_var(--signal-glow)]"
              spellCheck={false}
            />
          </div>
          <Button type="submit" className="self-start" disabled={pending}>
            {pending ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Sending…
              </span>
            ) : (
              'Send confirmation link'
            )}
          </Button>
          {validationError && <p className="text-base text-destructive-text">{validationError}</p>}
          {result?.status === 'invalid' && (
            <p role="status" className="text-base text-destructive-text">
              {result.message}
            </p>
          )}
          {result?.status === 'rate-limited' && (
            <p role="status" className="text-base text-destructive-text">
              Too many requests — please wait a minute and try again.
            </p>
          )}
          {result?.status === 'unavailable' && (
            <p role="status" className="text-base text-destructive-text">
              Something went wrong — please try again later.
            </p>
          )}
        </form>
      </FadeRise>
    </main>
  )
}
