'use client'

import { useState } from 'react'
import { isAddress } from 'viem'
import specJson from '../../spec/spec.json'
import { computeScore } from '@/lib/engine'
import { gatherInputs, type Scored } from '@/lib/orchestrate'
import type { Spec } from '@/lib/types'
import { CredentialCard } from '@/components/credential-card'
import { AttestPanel } from '@/components/attest-panel'

const spec = specJson as Spec

export default function Home() {
  const [addressInput, setAddressInput] = useState('')
  const [githubInput, setGithubInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scored, setScored] = useState<Scored | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const address = addressInput.trim()
    if (!isAddress(address)) {
      setError('That doesn’t look like an EVM address (0x…, 40 hex chars).')
      return
    }
    const githubHandle = githubInput.trim() || null
    setError(null)
    setLoading(true)
    setScored(null)
    try {
      const gather = await gatherInputs(address, githubHandle)
      setScored({ score: computeScore(gather.inputs, spec), gather, address, githubHandle })
    } catch {
      setError('Something went wrong while gathering data. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Open Builder Score</h1>
        <p className="text-sm text-zinc-400">
          Enter a wallet and get a Builder Score computed entirely in your browser from public
          data — no backend, no accounts. Spec v{spec.version}.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
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
          disabled={loading}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Reading public data…' : 'Compute score'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      {scored && (
        <section className="flex flex-col gap-6">
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-bold tabular-nums">{scored.score.total}</span>
            <span className="text-zinc-500">/ {scored.score.maxTotal}</span>
            {!scored.score.complete && (
              <span className="text-xs text-amber-500">
                partial — some sources couldn&apos;t be checked
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scored.score.perCredential.map((result) => (
              <CredentialCard key={result.slug} result={result} />
            ))}
          </div>

          <p className="text-xs text-zinc-600">
            github_repositories approximates production (public repo count vs. repos
            contributed-to). Computed at{' '}
            {new Date(scored.gather.inputs.computedAt * 1000).toISOString()}
            {scored.gather.baseBlockNumber !== null &&
              `, Base block ${scored.gather.baseBlockNumber}`}
            .
          </p>

          <AttestPanel scored={scored} />
        </section>
      )}
    </main>
  )
}
