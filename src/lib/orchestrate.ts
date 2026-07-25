import specJson from '../../spec/spec.json'
import { readChainCredentials, type ChainReadResult } from './chains'
import { readGithubCredentials } from './github'
import { readSpeedrunCredential } from './speedrun'
import { readVerifiedBuilder } from './easscan'
import type { CredentialInput, EngineInputs, ScoreResult, Spec } from './types'

const spec = specJson as Spec

export interface GatherResult {
  inputs: EngineInputs
  baseBlockNumber: bigint | null
}

// A fully computed score bundle as the UI screens pass it around.
export interface Scored {
  score: ScoreResult
  gather: GatherResult
  address: `0x${string}`
  githubHandle: string | null
}

export interface Fetchers {
  chains: (address: `0x${string}`, pocRpcSlugs: Set<string>) => Promise<ChainReadResult>
  github: (handle: string | null) => Promise<Record<string, CredentialInput>>
  speedrun: (address: string) => Promise<CredentialInput>
  verifiedBuilder: (address: string) => Promise<CredentialInput>
}

const defaultFetchers: Fetchers = {
  chains: readChainCredentials,
  github: readGithubCredentials,
  speedrun: readSpeedrunCredential,
  verifiedBuilder: readVerifiedBuilder,
}

export type GatherSource = 'chains' | 'github' | 'speedrun' | 'verifiedBuilder'

export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
  onSourceSettled?: (source: GatherSource) => void,
): Promise<GatherResult> {
  const f = { ...defaultFetchers, ...fetchers }
  const computedAt = Math.floor(Date.now() / 1000)
  const pocRpcSlugs = new Set(
    spec.credentials.filter((c) => c.poc && c.tier === 'rpc').map((c) => c.slug),
  )

  const settle = <T,>(source: GatherSource, promise: Promise<T>): Promise<T> =>
    promise.finally(() => onSourceSettled?.(source))

  const [chainResult, github, speedrun, verifiedBuilder] = await Promise.all([
    settle('chains', f.chains(address, pocRpcSlugs)),
    settle('github', f.github(githubHandle)),
    settle('speedrun', f.speedrun(address)),
    settle('verifiedBuilder', f.verifiedBuilder(address)),
  ])

  return {
    inputs: {
      computedAt,
      values: {
        ...chainResult.values,
        ...github,
        buidl_guidl_speedrun_ethereum: speedrun,
        talent_protocol_verified_builder: verifiedBuilder,
      },
    },
    baseBlockNumber: chainResult.baseBlockNumber,
  }
}
