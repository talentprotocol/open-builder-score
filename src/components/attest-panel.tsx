'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit'
import {
  useAccount,
  useDisconnect,
  useSignTypedData,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import {
  attestAggregateScore,
  attestScore,
  ATTEST_CHAIN_ID,
  EASSCAN_SITE,
} from '@/lib/eas'
import {
  canonicalExtraWallets,
  ownershipTypedData,
  verifyOwnershipProofs,
  OWNERSHIP_PROOF_TTL_SECONDS,
} from '@/lib/ownership'
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

export function AttestPanel({ scored }: { scored: Scored }) {
  const { address: connected, chainId } = useAccount()
  const { disconnectAsync } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const auth = useGithubAuth()
  const [busy, setBusy] = useState(false)
  const [signing, setSigning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attestationUid, setAttestationUid] = useState<string | null>(null)

  // Keyed by lowercased address. Component state rather than sessionStorage on
  // purpose: a reload re-runs the scan and mints a new computedAt, which is
  // bound into every signature, so persisted proofs could only ever be stale.
  // Switching accounts does not remount this component, which is the case that
  // actually matters.
  const [proofs, setProofs] = useState<Record<string, `0x${string}`>>({})

  // Canonical order here and nowhere else: the results page and inputPath keep
  // the user's typed order so shared URLs stay stable. Row index == onchain
  // proof index because the onchain array is exactly this one.
  const extras = canonicalExtraWallets(scored.address, scored.extraAddresses)
  const isAggregate = extras.length > 0

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
    connected !== undefined && connected.toLowerCase() === scored.address.toLowerCase()

  const onAttestChain = chainId === ATTEST_CHAIN_ID
  const allProved = extras.every((a) => proofs[a.toLowerCase()] !== undefined)
  const computedAt = scored.gather.inputs.computedAt
  const canAttest = dataComplete && handleVerified && walletOwned && onAttestChain && allProved

  async function handleSwitch() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await switchChainAsync({ chainId: ATTEST_CHAIN_ID })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network switch failed')
    } finally {
      setBusy(false)
    }
  }

  // Disconnect, then reconnect from scratch. Re-requesting the eth_accounts
  // permission is not enough: the permission is scoped to the accounts already
  // granted, so a wallet that exposed one account has nothing new to offer in
  // its picker. A fresh connection is what makes the wallet ask which account
  // to use, which is the only way to reach a wallet the site has never seen.
  async function handleConnectAs() {
    if (busy || signing) return
    setError(null)
    try {
      await disconnectAsync()
      openConnectModal?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect the current wallet')
    }
  }

  async function handleSign(wallet: `0x${string}`) {
    if (signing || busy) return
    setSigning(wallet.toLowerCase())
    setError(null)
    try {
      const typedData = ownershipTypedData({
        primary: scored.address,
        wallet,
        extras,
        computedAt,
      })
      const signature = await signTypedDataAsync(typedData)

      // Verify before storing. A wallet quirk — signing from a different account
      // than displayed, or a smart account returning something the validator
      // rejects — would otherwise surface at verify time, after gas was spent.
      const [check] = await verifyOwnershipProofs({
        primary: scored.address,
        extras: [wallet],
        proofs: [signature],
        computedAt,
        at: Math.floor(Date.now() / 1000),
      })
      if (check.status === 'invalid' || check.status === 'missing') {
        setError(
          `That signature doesn't verify as ${short(wallet)}. Check which account your wallet signed with.`,
        )
        return
      }
      if (check.status === 'unchecked') {
        setError(`Couldn't confirm the signature right now (${check.reason}). Try again.`)
        return
      }
      setProofs((prev) => ({ ...prev, [wallet.toLowerCase()]: signature }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed')
    } finally {
      setSigning(null)
    }
  }

  async function handleAttest() {
    if (!walletClient || busy || !canAttest) return
    // Authoritative expiry check. Rendered as static text rather than driven by
    // a timer — a stale render costs one clear error, a timer costs a whole
    // class of time-coupled state bugs.
    if (Math.floor(Date.now() / 1000) > computedAt + OWNERSHIP_PROOF_TTL_SECONDS) {
      setError('This scan is more than a day old — reload to rescan, then sign again.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const common = {
        walletClient,
        recipient: scored.address,
        specVersion: spec.version,
        githubHandle: scored.githubHandle,
        score: scored.score.total,
        computedAt,
        blockNumber: scored.gather.baseBlockNumber!,
      }
      const uid = isAggregate
        ? await attestAggregateScore({
            ...common,
            extraWallets: extras,
            ownershipProofs: extras.map((a) => proofs[a.toLowerCase()]),
            // Only what was actually earned. 'unavailable' is not 'earned', and
            // recording it as one would put an unverifiable claim onchain.
            badges: scored.badges.filter((b) => b.state === 'earned').map((b) => b.slug),
          })
        : await attestScore(common)
      setAttestationUid(uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attestation failed')
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
        {isAggregate &&
          ' Each other wallet signs once to prove it is yours; those signatures go into the attestation, so anyone can check them later.'}
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
          <h3 className="text-sm font-medium">Wallet ownership</h3>
          {!onAttestChain && (
            <p className="text-sm text-warning-text">
              Switch to Base Sepolia first — a wallet won&apos;t sign a message for a network
              it isn&apos;t on.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {extras.map((wallet) => {
              const signed = proofs[wallet.toLowerCase()] !== undefined
              const isConnected = connected?.toLowerCase() === wallet.toLowerCase()
              return (
                <li key={wallet} className="flex flex-wrap items-center gap-2 text-sm">
                  <PingDot settled={signed} />
                  <span className="break-all font-mono">{wallet}</span>
                  {signed ? (
                    <span className="text-success-text">✓ signed</span>
                  ) : isConnected ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleSign(wallet)}
                      disabled={signing !== null || busy || !onAttestChain}
                    >
                      {signing === wallet.toLowerCase() ? 'Waiting for wallet…' : 'Sign with this wallet'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleConnectAs}
                        disabled={signing !== null || busy}
                      >
                        Connect this wallet
                      </Button>
                      <span className="text-muted-foreground">
                        disconnects the current one, then pick this address.
                      </span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {connected && !walletOwned && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-warning-text">
            You&apos;re connected as <span className="font-mono break-all">{connected}</span>, but
            this score is for <span className="font-mono break-all">{scored.address}</span>.{' '}
            {isAggregate
              ? 'Connect the primary wallet to attest — it is the one that signs the transaction.'
              : 'Connect the scored wallet to attest it — an attestation only means something if the wallet signs for itself.'}
          </p>
          {/* The extra-wallet rows get a button; the primary needs the same one,
              or the last step of the flow is the only one with no way to act. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleConnectAs}
            disabled={signing !== null || busy}
          >
            Connect the primary wallet
          </Button>
        </div>
      )}

      {isAggregate && (
        <p className="text-xs text-muted-foreground">
          Signatures are tied to this scan and expire a day after it ran.{' '}
          <Link
            href={scorePath(scored.address, scored.githubHandle)}
            className="underline hover:text-foreground"
          >
            Score the primary wallet alone
          </Link>{' '}
          to attest without them.
        </p>
      )}

      {error && <p className="text-sm text-destructive-text break-all">{error}</p>}
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
