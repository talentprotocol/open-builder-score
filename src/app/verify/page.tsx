'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAttestationUid } from '@/lib/verify'
import { verifyPath } from '@/lib/routes'

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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Verify an attestation</h1>
        <p className="text-sm text-zinc-400">
          Paste a Builder Score attestation UID. Your browser fetches the attestation, recomputes
          the score from public data, and compares the two.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="uid" className="text-xs font-medium text-zinc-400">
            Attestation UID
          </label>
          <input
            id="uid"
            value={uidInput}
            onChange={(e) => setUidInput(e.target.value)}
            placeholder="0x…"
            className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium">
          Verify
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </main>
  )
}
