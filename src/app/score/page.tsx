'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'motion/react'
import { XIcon } from '@phosphor-icons/react/dist/ssr'
import { isAddress } from 'viem'
import { Button } from '@/components/ui/button'
import { inputPath, scorePath } from '@/lib/routes'
import { looksLikeEnsName, resolveEnsName } from '@/lib/ens'
import { GithubSignIn } from '@/components/github-sign-in'
import { useGithubAuth } from '@/components/use-github-auth'
import { FadeRise } from '@/components/motion/fade-rise'
import { useHasWalletSession } from '@/lib/wallet'
import { SPRING_SOFT } from '@/components/motion/presets'

const WalletPrefill = dynamic(() => import('@/components/wallet/wallet-prefill'), { ssr: false })

function ScoreForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [addressInput, setAddressInput] = useState(() => searchParams.get('wallet') ?? '')
  const [githubInput, setGithubInput] = useState(() => searchParams.get('github') ?? '')
  const nextRowId = useRef(0)
  const [extraInputs, setExtraInputs] = useState<{ id: number; value: string }[]>(() => {
    const raw = searchParams.get('wallets') ?? ''
    return raw
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w !== '')
      .slice(0, 4)
      .map((value) => ({ id: nextRowId.current++, value }))
  })
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  // Prefill from the connected wallet only while the user hasn't typed in the
  // field. A prefill from query params counts as touched.
  const touched = useRef(addressInput !== '')
  // The wallet stack is a lazy island; mount it only when a persisted wagmi
  // session exists — with no session there is no address to prefill.
  const walletSession = useHasWalletSession()

  function prefillFromWallet(address: string) {
    if (!touched.current) {
      setAddressInput((current) => (current === '' ? address : current))
    }
  }

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
    const recipient = addressInput.trim()
    const extras = extraInputs.map((w) => w.value.trim()).filter((w) => w !== '')
    setError(null)
    setResolving(true)
    const results = await Promise.all([recipient, ...extras].map(resolveWallet))
    setResolving(false)
    const failedAt = results.findIndex((r) => 'error' in r)
    if (failedAt !== -1) {
      const prefix = failedAt === 0 ? '' : `Wallet ${failedAt + 1}: `
      setError(prefix + (results[failedAt] as { error: string }).error)
      return
    }
    const [recipientAddress, ...extraAddresses] = results.map(
      (r) => (r as { address: string }).address,
    )
    const seen = new Set([recipientAddress.toLowerCase()])
    const deduped = extraAddresses.filter((a) => {
      if (seen.has(a.toLowerCase())) return false
      seen.add(a.toLowerCase())
      return true
    })
    router.push(scorePath(recipientAddress, githubInput, deduped))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {walletSession && <WalletPrefill onAddress={prefillFromWallet} />}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="wallet" className="text-sm font-medium text-muted-foreground">
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
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-base transition-shadow focus:outline-none focus:ring-1 focus:ring-success/60 focus:shadow-[0_0_18px_var(--signal-glow)]"
          spellCheck={false}
        />
      </div>
      <AnimatePresence initial={false}>
        {extraInputs.map((row, i) => (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING_SOFT}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 pb-0.5">
              <label
                htmlFor={`wallet-${i + 2}`}
                className="text-sm font-medium text-muted-foreground"
              >
                Wallet {i + 2}
              </label>
              <div className="flex gap-2">
                <input
                  id={`wallet-${i + 2}`}
                  value={row.value}
                  onChange={(e) =>
                    setExtraInputs((prev) =>
                      prev.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  placeholder="0x… or name.eth"
                  className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-base transition-shadow focus:outline-none focus:ring-1 focus:ring-success/60 focus:shadow-[0_0_18px_var(--signal-glow)]"
                  spellCheck={false}
                />
                <button
                  type="button"
                  aria-label={`Remove wallet ${i + 2}`}
                  onClick={() => setExtraInputs((prev) => prev.filter((r) => r.id !== row.id))}
                  className="rounded-md border border-border px-3 text-base text-muted-foreground transition-colors hover:bg-accent"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {extraInputs.length < 4 && (
        <button
          type="button"
          onClick={() => setExtraInputs((prev) => [...prev, { id: nextRowId.current++, value: '' }])}
          className="self-start text-sm text-muted-foreground underline transition-colors hover:text-foreground"
        >
          + Add another wallet
        </button>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="github" className="text-sm font-medium text-muted-foreground">
          GitHub handle <span className="font-normal text-muted-foreground/70">(optional)</span>
        </label>
        <input
          id="github"
          value={githubInput}
          onChange={(e) => {
            githubTouched.current = true
            setGithubInput(e.target.value)
          }}
          placeholder="octocat"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-base transition-shadow focus:outline-none focus:ring-1 focus:ring-success/60 focus:shadow-[0_0_18px_var(--signal-glow)]"
          spellCheck={false}
        />
      </div>
      <GithubSignIn
        // Sign-in leaves the page; everything typed so far must ride along in
        // the return URL or it is lost. inputPath emits exactly the params the
        // form's initializers above read back.
        returnTo={inputPath(
          addressInput,
          githubInput,
          extraInputs.map((row) => row.value),
        )}
        onVerified={(login) => {
          githubTouched.current = true
          setGithubInput(login)
        }}
      />
      <Button type="submit" disabled={resolving} className="self-start">
        {resolving ? 'Resolving name…' : 'Compute score'}
      </Button>
      {error && <p className="text-base text-destructive-text">{error}</p>}
    </form>
  )
}

export default function ScorePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 flex flex-col">
      <FadeRise className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-xl font-normal">Check a Builder Score</h1>
          <p className="text-base text-muted-foreground">
            Enter any wallet or ENS name — add up to 4 more to aggregate one score across them.
            Scoring runs entirely in your browser — connecting a wallet is only needed to attest.
          </p>
        </header>
        <Suspense fallback={null}>
          <ScoreForm />
        </Suspense>
      </FadeRise>
    </main>
  )
}
