'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAttestationUid } from '@/lib/verify'
import { verifyPath } from '@/lib/routes'
import { FadeRise } from '@/components/motion/fade-rise'
import { Button } from '@/components/ui/button'

export default function VerifyPage() {
  const router = useRouter()
  const [uidInput, setUidInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const uid = uidInput.trim()
    if (!isAttestationUid(uid)) {
      setError('That doesn’t look like an attestation UID (0x…, 64 hex chars).')
      return
    }
    setError(null)
    router.push(verifyPath(uid))
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col">
      <FadeRise className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-normal">Verify an attestation</h1>
          <p className="text-base text-muted-foreground">
            Paste a Builder Score attestation UID. Your browser fetches the attestation, recomputes
            the score from public data, and compares the two.
          </p>
        </header>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="uid" className="text-sm font-medium text-muted-foreground">
              Attestation UID
            </label>
            <input
              id="uid"
              value={uidInput}
              onChange={(e) => setUidInput(e.target.value)}
              placeholder="0x…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-base transition-shadow focus:outline-none focus:ring-1 focus:ring-success/60 focus:shadow-[0_0_18px_var(--signal-glow)]"
              spellCheck={false}
            />
          </div>
          <Button type="submit" className="self-start">
            Verify
          </Button>
          {error && <p className="text-base text-destructive-text">{error}</p>}
        </form>
      </FadeRise>
    </main>
  )
}
