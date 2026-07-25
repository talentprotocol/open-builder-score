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
  const [extraInputs, setExtraInputs] = useState<string[]>(() => {
    const raw = searchParams.get('wallets') ?? ''
    return raw
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w !== '')
      .slice(0, 4)
  })
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

  async function resolveWallet(
    input: string,
  ): Promise<{ address: string } | { error: string }> {
    if (isAddress(input)) return { address: input }
    if (looksLikeEnsName(input)) {
      const resolution = await resolveEnsName(input)
      if (resolution.status === 'resolved') return { address: resolution.address }
      if (resolution.status === 'unresolved')
        return { error: `“${input}” doesn’t resolve to an address.` }
      return { error: resolution.reason }
    }
    return { error: 'Enter an EVM address (0x…, 40 hex chars) or an ENS name.' }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const primary = addressInput.trim()
    const extras = extraInputs.map((w) => w.trim()).filter((w) => w !== '')
    setError(null)
    setResolving(true)
    const results = await Promise.all([primary, ...extras].map(resolveWallet))
    setResolving(false)
    const failedAt = results.findIndex((r) => 'error' in r)
    if (failedAt !== -1) {
      const prefix = failedAt === 0 ? '' : `Wallet ${failedAt + 1}: `
      setError(prefix + (results[failedAt] as { error: string }).error)
      return
    }
    const [primaryAddress, ...extraAddresses] = results.map(
      (r) => (r as { address: string }).address,
    )
    const seen = new Set([primaryAddress.toLowerCase()])
    const deduped = extraAddresses.filter((a) => {
      if (seen.has(a.toLowerCase())) return false
      seen.add(a.toLowerCase())
      return true
    })
    router.push(scorePath(primaryAddress, githubInput, deduped))
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
      {extraInputs.map((value, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <label htmlFor={`wallet-${i + 2}`} className="text-xs font-medium text-zinc-400">
            Wallet {i + 2}
          </label>
          <div className="flex gap-2">
            <input
              id={`wallet-${i + 2}`}
              value={value}
              onChange={(e) =>
                setExtraInputs((prev) => prev.map((w, j) => (j === i ? e.target.value : w)))
              }
              placeholder="0x… or name.eth"
              className="flex-1 rounded-md border border-zinc-700 bg-transparent px-3 py-2 font-mono text-sm"
              spellCheck={false}
            />
            <button
              type="button"
              aria-label={`Remove wallet ${i + 2}`}
              onClick={() => setExtraInputs((prev) => prev.filter((_, j) => j !== i))}
              className="rounded-md border border-zinc-700 px-3 text-sm text-zinc-400"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {extraInputs.length < 4 && (
        <button
          type="button"
          onClick={() => setExtraInputs((prev) => [...prev, ''])}
          className="self-start text-xs text-zinc-400 underline"
        >
          + Add another wallet
        </button>
      )}
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
          Enter any wallet or ENS name — add up to 4 more to aggregate one score across them.
          Scoring runs entirely in your browser — connecting a wallet is only needed to attest.
        </p>
      </header>
      <Suspense fallback={null}>
        <ScoreForm />
      </Suspense>
    </main>
  )
}
