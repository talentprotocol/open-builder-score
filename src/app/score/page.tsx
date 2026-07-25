'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { scorePath } from '@/lib/routes'
import { looksLikeEnsName, resolveEnsName } from '@/lib/ens'
import { GithubSignIn } from '@/components/github-sign-in'
import { useGithubAuth } from '@/components/use-github-auth'

function ScoreForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address: connected } = useAccount()

  const [addressInput, setAddressInput] = useState(() => searchParams.get('wallet') ?? '')
  const [githubInput, setGithubInput] = useState(() => searchParams.get('github') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  // Prefill from the connected wallet only while the user hasn't typed in the
  // field. A prefill from query params counts as touched.
  const touched = useRef(addressInput !== '')

  useEffect(() => {
    if (!touched.current && addressInput === '' && connected) {
      setAddressInput(connected)
    }
  }, [connected, addressInput])

  const auth = useGithubAuth()
  // Prefill the handle from a verified session only while untouched — mirrors
  // the connected-wallet prefill.
  const githubTouched = useRef(githubInput !== '')

  useEffect(() => {
    if (!githubTouched.current && githubInput === '' && auth) {
      setGithubInput(auth.login)
    }
  }, [auth, githubInput])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const input = addressInput.trim()
    if (isAddress(input)) {
      setError(null)
      router.push(scorePath(input, githubInput))
      return
    }
    if (looksLikeEnsName(input)) {
      setError(null)
      setResolving(true)
      const resolution = await resolveEnsName(input)
      setResolving(false)
      if (resolution.status === 'resolved') {
        router.push(scorePath(resolution.address, githubInput))
      } else if (resolution.status === 'unresolved') {
        setError(`“${input}” doesn’t resolve to an address.`)
      } else {
        setError(resolution.reason)
      }
      return
    }
    setError('Enter an EVM address (0x…, 40 hex chars) or an ENS name.')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="wallet" className="text-xs font-medium text-zinc-400">
          Wallet address or ENS name
        </label>
        <input
          id="wallet"
          value={addressInput}
          onChange={(e) => {
            touched.current = true
            setAddressInput(e.target.value)
          }}
          placeholder="0x… or name.eth"
          className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="github" className="text-xs font-medium text-zinc-400">
          GitHub handle <span className="font-normal text-zinc-600">(optional)</span>
        </label>
        <input
          id="github"
          value={githubInput}
          onChange={(e) => {
            githubTouched.current = true
            setGithubInput(e.target.value)
          }}
          placeholder="octocat"
          className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
          spellCheck={false}
        />
      </div>
      <GithubSignIn
        onVerified={(login) => {
          githubTouched.current = true
          setGithubInput(login)
        }}
      />
      <button
        type="submit"
        disabled={resolving}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {resolving ? 'Resolving name…' : 'Compute score'}
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
          Enter any wallet or ENS name. Scoring runs entirely in your browser — connecting a wallet is only
          needed to attest.
        </p>
      </header>
      <Suspense fallback={null}>
        <ScoreForm />
      </Suspense>
    </main>
  )
}
