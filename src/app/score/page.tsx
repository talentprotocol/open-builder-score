'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { scorePath } from '@/lib/routes'

function ScoreForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address: connected } = useAccount()

  const [addressInput, setAddressInput] = useState(() => searchParams.get('wallet') ?? '')
  const [githubInput, setGithubInput] = useState(() => searchParams.get('github') ?? '')
  const [error, setError] = useState<string | null>(null)
  // Prefill from the connected wallet only while the user hasn't typed in the
  // field. A prefill from query params counts as touched.
  const touched = useRef(addressInput !== '')

  useEffect(() => {
    if (!touched.current && addressInput === '' && connected) {
      setAddressInput(connected)
    }
  }, [connected, addressInput])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const address = addressInput.trim()
    if (!isAddress(address)) {
      setError('That doesn’t look like an EVM address (0x…, 40 hex chars).')
      return
    }
    setError(null)
    router.push(scorePath(address, githubInput))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        value={addressInput}
        onChange={(e) => {
          touched.current = true
          setAddressInput(e.target.value)
        }}
        placeholder="Wallet address (0x…)"
        className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
        spellCheck={false}
      />
      <input
        value={githubInput}
        onChange={(e) => setGithubInput(e.target.value)}
        placeholder="GitHub handle (optional)"
        className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
        spellCheck={false}
      />
      <button
        type="submit"
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium"
      >
        Compute score
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  )
}

export default function ScorePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Check a Builder Score</h1>
        <p className="text-sm text-zinc-400">
          Enter any wallet. Scoring runs entirely in your browser — connecting a wallet is only
          needed to attest.
        </p>
      </header>
      <Suspense fallback={null}>
        <ScoreForm />
      </Suspense>
    </main>
  )
}
