import specJson from '../../spec/spec.json'
import { readChainCredentials, type ChainReadResult } from './chains'
import { readGithubCredentials } from './github'
import { readSpeedrunCredential } from './speedrun'
import { readVerifiedBuilder } from './easscan'
import { readNftCredentials } from './nft-credentials'
import type { BadgeResult, CredentialInput, EngineInputs, ScoreResult, Spec } from './types'

const spec = specJson as Spec

export interface GatherResult {
  inputs: EngineInputs
  baseBlockNumber: bigint | null
}

// A fully computed score bundle as the UI screens pass it around.
// Badges ride along but stay outside `score`: they carry no points and must
// never gate attestation, so nothing downstream reads them as scoring input.
export interface Scored {
  score: ScoreResult
  gather: GatherResult
  address: `0x${string}`
  githubHandle: string | null
  extraAddresses: `0x${string}`[]
  badges: BadgeResult[]
}

export interface Fetchers {
  chains: (address: `0x${string}`, activeRpcSlugs: Set<string>) => Promise<ChainReadResult>
  github: (handle: string | null) => Promise<Record<string, CredentialInput>>
  speedrun: (address: string) => Promise<CredentialInput>
  verifiedBuilder: (address: string) => Promise<CredentialInput>
  nftCredentials: (address: string) => Promise<Record<string, CredentialInput>>
}

const defaultFetchers: Fetchers = {
  chains: readChainCredentials,
  github: readGithubCredentials,
  speedrun: readSpeedrunCredential,
  verifiedBuilder: readVerifiedBuilder,
  nftCredentials: (address) => readNftCredentials(address),
}

export type GatherSource = 'chains' | 'github' | 'speedrun' | 'verifiedBuilder' | 'nftCredentials'

// Two per-wallet results for the same credential become one: accounts
// concatenate in wallet order; if either wallet couldn't be checked the
// merged credential stays unavailable ("couldn't check" ≠ "not earned").
export function mergeCredentialInputs(a: CredentialInput, b: CredentialInput): CredentialInput {
  if (a.status === 'unavailable') return a
  if (b.status === 'unavailable') return b
  return { status: 'ok', accounts: [...a.accounts, ...b.accounts] }
}

export async function gatherMultiInputs(
  addresses: `0x${string}`[],
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
  onSourceSettled?: (source: GatherSource) => void,
): Promise<GatherResult> {
  if (addresses.length === 0) throw new Error('gatherMultiInputs requires at least one address')
  const f = { ...defaultFetchers, ...fetchers }
  const computedAt = Math.floor(Date.now() / 1000)
  // Derives the chain set too (chains.ts groups the reads by contract chain),
  // so excluding a credential also stops us dialling any chain it was the only
  // reason to read.
  const activeRpcSlugs = new Set(
    spec.credentials.filter((c) => c.status === 'active' && c.tier === 'rpc').map((c) => c.slug),
  )

  const settle = <T,>(source: GatherSource, promise: Promise<T>): Promise<T> =>
    promise.finally(() => onSourceSettled?.(source))

  const [chainResults, github, speedruns, verifiedBuilders, nftResults] = await Promise.all([
    settle('chains', Promise.all(addresses.map((a) => f.chains(a, activeRpcSlugs)))),
    settle('github', f.github(githubHandle)),
    settle('speedrun', Promise.all(addresses.map((a) => f.speedrun(a)))),
    settle('verifiedBuilder', Promise.all(addresses.map((a) => f.verifiedBuilder(a)))),
    settle('nftCredentials', Promise.all(addresses.map((a) => f.nftCredentials(a)))),
  ])

  const chainValues: Record<string, CredentialInput> = {}
  for (const result of chainResults) {
    for (const [slug, input] of Object.entries(result.values)) {
      chainValues[slug] =
        slug in chainValues ? mergeCredentialInputs(chainValues[slug], input) : input
    }
  }

  // Same fold as the chain reads, and the same rule inside
  // mergeCredentialInputs: one wallet that couldn't be checked leaves the
  // credential unavailable rather than letting the others report a clean zero.
  const nftValues: Record<string, CredentialInput> = {}
  for (const perWallet of nftResults) {
    for (const [slug, input] of Object.entries(perWallet)) {
      nftValues[slug] = slug in nftValues ? mergeCredentialInputs(nftValues[slug], input) : input
    }
  }

  return {
    inputs: {
      computedAt,
      values: {
        ...chainValues,
        ...nftValues,
        ...github,
        buidl_guidl_speedrun_ethereum: speedruns.reduce(mergeCredentialInputs),
        talent_protocol_verified_builder: verifiedBuilders.reduce(mergeCredentialInputs),
      },
    },
    // The as-of anchor stays the recipient wallet's.
    baseBlockNumber: chainResults[0].baseBlockNumber,
  }
}

export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
  onSourceSettled?: (source: GatherSource) => void,
): Promise<GatherResult> {
  return gatherMultiInputs([address], githubHandle, fetchers, onSourceSettled)
}
