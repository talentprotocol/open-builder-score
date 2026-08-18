'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit'
import {
  useAccount,
  useDisconnect,
  useSignTypedData,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import { ATTEST_CHAIN_ID, EASSCAN_SITE, AGGREGATE_PREFLIGHT_ERRORS } from '@/lib/eas'
import { WalletProviders } from '@/components/wallet/wallet-providers'
import {
  canonicalExtraWallets,
  ownershipTypedData,
  verifyOwnershipProofs,
  OWNERSHIP_PROOF_TTL_SECONDS,
  ISSUED_AT_SKEW_ALLOWANCE_SECONDS,
} from '@/lib/ownership'
import {
  getOrCreateProofSession,
  saveProof,
  clearProofSession,
  type ProofSession,
} from '@/lib/proof-store'
import { describeWalletError, type WalletErrorInfo } from '@/lib/wallet-errors'
import { clientFor } from '@/lib/chains'
import { scorePath, verifyPath } from '@/lib/routes'
import { useGithubAuth } from '@/components/use-github-auth'
import { PingDot } from '@/components/motion/ping-dot'
import { FadeRise } from '@/components/motion/fade-rise'
import { Button } from '@/components/ui/button'
import specJson from '../../spec/spec.json'
import type { Spec } from '@/lib/types'
import type { Scored } from '@/lib/orchestrate'

const spec = specJson as Spec

const EXPLORER_BASE = `${EASSCAN_SITE}/attestation/view/`

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// Loaded lazily by the score results page (next/dynamic, ssr: false) and
// self-wrapped in WalletProviders: the wagmi/RainbowKit stack ships in this
// chunk instead of every page's first load.
export default function AttestPanel({ scored }: { scored: Scored }) {
  return (
    <WalletProviders>
      <AttestPanelInner scored={scored} />
    </WalletProviders>
  )
}

function AttestPanelInner({ scored }: { scored: Scored }) {
  const { address: connected, chainId } = useAccount()
  const { disconnectAsync } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const auth = useGithubAuth()
  const [busy, setBusy] = useState(false)
  const [signing, setSigning] = useState<string | null>(null)
  const [error, setError] = useState<WalletErrorInfo | null>(null)
  const [attestationUid, setAttestationUid] = useState<string | null>(null)

  // Canonical order here and nowhere else: the results page and inputPath keep
  // the user's typed order so shared URLs stay stable. Row index == onchain
  // proof index because the onchain array is exactly this one.
  const recipient = scored.address
  const extras = canonicalExtraWallets(recipient, scored.extraAddresses)
  const rows = [recipient, ...extras]
  const isAggregate = extras.length > 0

  // Loaded in an effect: localStorage is browser-only and this component SSRs.
  const [session, setSession] = useState<ProofSession | null>(null)
  useEffect(() => {
    if (!isAggregate) return
    // Deferred one microtask out: reading localStorage/Date.now is exactly the
    // kind of external-system sync effects exist for, but setting state from
    // their result must not happen synchronously in the effect body itself.
    queueMicrotask(() => {
      setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
    })
    // Canonical set is derived state; key it by its serialisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAggregate, recipient, extras.join(',')])

  const proofFor = (w: string) => session?.proofs[w.toLowerCase()]
  const connectedLower = connected?.toLowerCase()
  const connectedInSet = rows.some((w) => w.toLowerCase() === connectedLower)
  // Every wallet except the connected one must hold a signature; the connected
  // one proves itself by sending the transaction.
  const missingOthers = rows.filter(
    (w) => w.toLowerCase() !== connectedLower && proofFor(w) === undefined,
  )
  const setProved = connectedInSet && missingOthers.length === 0

  const dataComplete = scored.score.complete && scored.gather.baseBlockNumber !== null

  // A handle-bearing attestation requires the signed-in GitHub user to be that
  // handle. Handle-less attestations are unrestricted.
  const handleVerified =
    scored.githubHandle === null ||
    (auth !== null && auth.login.toLowerCase() === scored.githubHandle.toLowerCase())

  // The attestation's claim is "this wallet signed for itself" — EAS records the
  // attester as msg.sender. Checked here rather than with a SIWE message because
  // the transaction signature is the proof, and unlike a browser-only
  // personal_sign anyone can verify it afterwards.
  const walletOwned =
    connected !== undefined && connected.toLowerCase() === recipient.toLowerCase()

  const onAttestChain = chainId === ATTEST_CHAIN_ID
  const computedAt = scored.gather.inputs.computedAt
  const canAttest = isAggregate
    ? dataComplete && handleVerified && onAttestChain && setProved && session !== null
    : dataComplete && handleVerified && onAttestChain && walletOwned

  async function handleSwitch() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await switchChainAsync({ chainId: ATTEST_CHAIN_ID })
    } catch (e) {
      setError(describeWalletError(e, 'switch'))
    } finally {
      setBusy(false)
    }
  }

  // Disconnect, then reconnect from scratch. Re-requesting the eth_accounts
  // permission is not enough: the permission is scoped to the accounts already
  // granted, so a wallet that exposed one account has nothing new to offer in
  // its picker. A fresh connection is what makes the wallet ask which account
  // to use, which is the only way to reach a wallet the site has never seen.
  //
  // openConnectModal is undefined while a wallet is connected — RainbowKit
  // only defines it once it sees the disconnected state. Calling it from this
  // closure would close over the stale (connected-time) undefined, which is
  // why the modal never used to open. Instead this sets a flag that the
  // effect below watches, opening the modal once openConnectModal actually
  // becomes callable.
  const [pendingConnect, setPendingConnect] = useState(false)

  async function handleConnectAs() {
    if (busy || signing) return
    setError(null)
    try {
      await disconnectAsync()
      setPendingConnect(true)
    } catch (e) {
      setError(describeWalletError(e, 'connect'))
    }
  }

  useEffect(() => {
    if (!pendingConnect || !openConnectModal) return
    // Deferred one microtask out for the same reason the other effects are:
    // the state clear below must not read as synchronous-in-effect. Clearing
    // first (in source order) then opening means a re-render triggered by the
    // clear can't see pendingConnect still true and open a second modal.
    queueMicrotask(() => {
      setPendingConnect(false)
      openConnectModal()
    })
  }, [pendingConnect, openConnectModal])

  async function handleSign(wallet: `0x${string}`) {
    if (signing || busy || session === null) return
    setSigning(wallet.toLowerCase())
    setError(null)
    try {
      const typedData = ownershipTypedData({ recipient, wallet, extras, issuedAt: session.issuedAt })
      const signature = await signTypedDataAsync(typedData)

      // Verify inside the full set before storing (a wallet signing from a
      // different account than displayed would otherwise surface after gas was
      // spent). The old preflight verified against a one-wallet set — with two
      // or more extras every signature "failed". This one cannot: the check
      // rebuilds exactly what was signed.
      const idx = rows.findIndex((w) => w.toLowerCase() === wallet.toLowerCase())
      const checks = await verifyOwnershipProofs({
        recipient,
        extras,
        proofs: extras.map((w) => (w.toLowerCase() === wallet.toLowerCase() ? signature : '0x')),
        recipientProof: wallet.toLowerCase() === recipient.toLowerCase() ? signature : '0x',
        attester: null,
        issuedAt: session.issuedAt,
        at: Math.floor(Date.now() / 1000),
      })
      const check = checks[idx]
      if (check.status === 'invalid' || check.status === 'missing') {
        setError({
          message: `That signature doesn't verify as ${short(wallet)}. Check which account your wallet signed with.`,
          detail: null,
          cancelled: false,
        })
        return
      }
      if (check.status === 'unchecked') {
        setError({
          message: `Couldn't confirm the signature right now (${check.reason}). Try again.`,
          detail: null,
          cancelled: false,
        })
        return
      }
      if (check.status === 'expired') {
        setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
        setError({ message: 'These signatures expired — a fresh window was started, sign again.', detail: null, cancelled: false })
        return
      }
      const next = saveProof(localStorage, recipient, extras, wallet, signature, Math.floor(Date.now() / 1000))
      if (next) setSession(next)
    } catch (e) {
      setError(describeWalletError(e, 'sign'))
    } finally {
      setSigning(null)
    }
  }

  // Auto-prompt: a freshly connected wallet that matches a pending row signs
  // immediately — unless it is the only unproven one, in which case it needs
  // nothing: it will prove itself by sending the transaction.
  const prevConnected = useRef<string | undefined>(undefined)
  useEffect(() => {
    // Bail without recording while off-chain: a wallet connected on the
    // wrong network hasn't had its chance to be prompted yet. Recording it
    // here would make `changed` false once the network switch lands (this
    // effect re-runs on the onAttestChain flip), so the prompt would never
    // fire for it — the bug this guard fixes. Every other bail path below
    // still records, so a dismissed/already-handled wallet doesn't re-prompt
    // in a loop.
    if (!onAttestChain) return
    const changed = connectedLower !== prevConnected.current
    prevConnected.current = connectedLower
    if (!changed || !isAggregate || !connectedLower || session === null) return
    if (signing || busy) return
    const mine = rows.find((w) => w.toLowerCase() === connectedLower)
    if (!mine || proofFor(mine)) return
    const othersPending = rows.some(
      (w) => w.toLowerCase() !== connectedLower && proofFor(w) === undefined,
    )
    if (!othersPending) return
    // Deferred one microtask out for the same reason the session load is:
    // handleSign's setState calls must not read as synchronous-in-effect.
    queueMicrotask(() => {
      void handleSign(mine)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedLower, onAttestChain, session, isAggregate])

  async function handleAttest() {
    if (!walletClient || busy || !canAttest) return
    setBusy(true)
    setError(null)
    try {
      // Authoritative expiry check. Rendered as static text rather than driven by
      // a timer — a stale render costs one clear error, a timer costs a whole
      // class of time-coupled state bugs.
      if (isAggregate) {
        if (session === null) return
        if (Math.floor(Date.now() / 1000) > session.issuedAt + OWNERSHIP_PROOF_TTL_SECONDS) {
          clearProofSession(localStorage, recipient, extras)
          setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
          setError({ message: 'These signatures expired — sign again to attest.', detail: null, cancelled: false })
          return
        }
        // Attest-time clock-skew guard: issuedAt is minted from the client
        // clock (the session effect below), but verify later checks it
        // against the chain clock (att.timeCreated). A client clock running
        // ahead would mint proofs that can never pass that check — catch it
        // here, before gas is spent, rather than after. Couldn't-check is not
        // the same as failed: an RPC hiccup on this read must not block attest.
        try {
          const block = await clientFor(ATTEST_CHAIN_ID).getBlock()
          if (session.issuedAt > Number(block.timestamp) + ISSUED_AT_SKEW_ALLOWANCE_SECONDS) {
            clearProofSession(localStorage, recipient, extras)
            setSession(getOrCreateProofSession(localStorage, recipient, extras, Math.floor(Date.now() / 1000)))
            setError({
              message:
                'Your device clock looks ahead of the network — signatures would not verify. Fix the clock, then sign again.',
              detail: null,
              cancelled: false,
            })
            return
          }
        } catch {
          // RPC read failed — proceed. Couldn't check is not the same as failed.
        }
      }
      const common = {
        walletClient,
        recipient,
        specVersion: spec.version,
        githubHandle: scored.githubHandle,
        score: scored.score.total,
        computedAt,
        blockNumber: scored.gather.baseBlockNumber!,
      }
      // The EAS SDK + ethers load here, on the click that needs them —
      // they are the heaviest dependencies in the app and nothing else uses them.
      const { attestScore, attestAggregateScore } = await import('@/lib/eas-attest')
      const uid = isAggregate
        ? await attestAggregateScore({
            ...common,
            extraWallets: extras,
            ownershipProofs: extras.map((w) =>
              w.toLowerCase() === connectedLower ? '0x' : session!.proofs[w.toLowerCase()],
            ),
            recipientProof:
              recipient.toLowerCase() === connectedLower ? '0x' : session!.proofs[recipient.toLowerCase()],
            proofsIssuedAt: session!.issuedAt,
            // Only what was actually earned. 'unavailable' is not 'earned', and
            // recording it as one would put an unverifiable claim onchain.
            badges: scored.badges.filter((b) => b.state === 'earned').map((b) => b.slug),
          })
        : await attestScore(common)
      setAttestationUid(uid)
    } catch (e) {
      const message = e instanceof Error ? e.message : null
      // Pre-transaction throws (slot guard, 'wallet not connected', the encode
      // invariants) happen before any signer or transaction exists, so "The
      // attestation failed onchain" would be false. They're already
      // human-readable one-liners — show them as the headline verbatim
      // instead of routing through the generic post-tx wallet-error mapping.
      if (message !== null && AGGREGATE_PREFLIGHT_ERRORS.includes(message)) {
        setError({ message, detail: null, cancelled: false })
      } else {
        setError(describeWalletError(e, 'attest'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs dark:bg-card/50">
      <h2 className="text-base font-medium">
        Attest {isAggregate ? 'this aggregate score' : 'this score'} onchain
      </h2>
      <p className="text-sm text-muted-foreground">
        You sign, you pay. The attestation embeds the spec version, score, and the as-of anchor
        so anyone can recompute and verify it.
      </p>

      {!dataComplete && (
        <p className="text-sm text-warning-text">
          Attestation is disabled while any source is unavailable — an attested score must be
          computed from complete data.
        </p>
      )}

      {dataComplete && !handleVerified && (
        <p className="text-sm text-warning-text">
          This score includes the GitHub handle @{scored.githubHandle}, which hasn&apos;t been
          verified. Sign in with GitHub on the form screen (Edit inputs) to prove it&apos;s yours
          before attesting.
        </p>
      )}

      {/* ConnectButton stays mounted through every gate so the user can switch
          accounts — which the aggregate flow requires them to do repeatedly. */}
      <div className="flex flex-wrap items-center gap-3">
        <ConnectButton showBalance={false} />
        {connected && !onAttestChain && (
          <Button onClick={handleSwitch} disabled={busy}>
            {busy ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Switching…
              </span>
            ) : (
              'Switch to Base Sepolia'
            )}
          </Button>
        )}
        {connected && onAttestChain && (
          <Button onClick={handleAttest} disabled={busy || !canAttest || !walletClient}>
            {busy ? (
              <span className="flex items-center gap-2">
                <PingDot settled={false} /> Waiting for wallet…
              </span>
            ) : (
              'Attest onchain'
            )}
          </Button>
        )}
      </div>

      {isAggregate && dataComplete && handleVerified && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background/40 p-3">
          <h3 className="text-sm font-medium">Prove ownership</h3>
          <p className="text-sm text-muted-foreground">
            Each wallet proves ownership once: the one that sends the transaction proves itself;
            the rest sign a free message.
          </p>
          {!onAttestChain && connected && (
            <p className="text-sm text-warning-text">
              Switch to Base Sepolia first — a wallet won&apos;t sign a message for a network it
              isn&apos;t on.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((wallet) => {
              const lower = wallet.toLowerCase()
              const signed = proofFor(wallet) !== undefined
              const isConnected = lower === connectedLower
              const isRecipient = lower === recipient.toLowerCase()
              const proved = signed || isConnected
              return (
                <li key={wallet} className="flex flex-wrap items-center gap-2 text-sm">
                  <PingDot settled={proved} />
                  <span className="break-all font-mono">{wallet}</span>
                  {isRecipient && (
                    <span className="text-xs text-muted-foreground">score address</span>
                  )}
                  {isConnected ? (
                    !signed && missingOthers.length > 0 ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSign(wallet)}
                          disabled={signing !== null || busy || !onAttestChain}
                        >
                          {signing === lower ? 'Waiting for wallet…' : 'Sign with this wallet'}
                        </Button>
                        <span className="text-muted-foreground">
                          will send the transaction — or sign so any other wallet can
                        </span>
                      </>
                    ) : (
                      <span className="text-success-text">
                        ✓ proves itself by sending the transaction
                      </span>
                    )
                  ) : signed ? (
                    <span className="text-success-text">✓ signed</span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleConnectAs}
                        disabled={signing !== null || busy}
                      >
                        Connect &amp; sign
                      </Button>
                      <span className="text-muted-foreground">
                        disconnects the current wallet, then pick this address — the signature
                        request follows on its own.
                      </span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {session !== null && (
            <p className="text-xs text-muted-foreground">
              Signatures are valid until{' '}
              {new Date((session.issuedAt + OWNERSHIP_PROOF_TTL_SECONDS) * 1000).toLocaleString()}{' '}
              and survive page reloads.{' '}
              <Link
                href={scorePath(recipient, scored.githubHandle)}
                className="underline hover:text-foreground"
              >
                Score this address alone
              </Link>{' '}
              to attest without extra signatures.
            </p>
          )}
        </div>
      )}

      {isAggregate
        ? connected &&
          !connectedInSet && (
            <p className="text-sm text-warning-text">
              You&apos;re connected as <span className="font-mono break-all">{connected}</span>,
              which isn&apos;t one of the scored wallets. Connect any wallet from the list above —
              whichever is connected when you attest is the one that sends the transaction.
            </p>
          )
        : connected &&
          !walletOwned && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-warning-text">
                You&apos;re connected as <span className="font-mono break-all">{connected}</span>,
                but this score is for{' '}
                <span className="font-mono break-all">{scored.address}</span>. Connect the scored
                wallet to attest it — an attestation only means something if the wallet signs for
                itself.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleConnectAs}
                disabled={signing !== null || busy}
              >
                Connect the scored wallet
              </Button>
            </div>
          )}

      {error && (
        <div className={`text-sm ${error.cancelled ? 'text-muted-foreground' : 'text-destructive-text'}`}>
          <p>{error.message}</p>
          {error.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Technical detail
              </summary>
              <p className="break-all font-mono text-xs text-muted-foreground">{error.detail}</p>
            </details>
          )}
        </div>
      )}
      {attestationUid && (
        <FadeRise>
          <div className="flex flex-col gap-1">
            <a
              href={`${EXPLORER_BASE}${attestationUid}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-success-text underline break-all"
            >
              Attested — view {attestationUid} on easscan
            </a>
            <Link
              href={verifyPath(attestationUid)}
              className="text-sm text-success-text underline"
            >
              Verify it here
            </Link>
          </div>
        </FadeRise>
      )}
    </div>
  )
}
