import specJson from '../../spec/spec.json'
import { readChainCredentials, type ChainReadResult } from './chains'
import { readGithubCredentials } from './github'
import { readSpeedrunCredential } from './speedrun'
import { readVerifiedBuilder } from './easscan'
import type { CredentialInput, EngineInputs, Spec } from './types'

const spec = specJson as Spec

export interface GatherResult {
  inputs: EngineInputs
  baseBlockNumber: bigint | null
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

export async function gatherInputs(
  address: `0x${string}`,
  githubHandle: string | null,
  fetchers: Partial<Fetchers> = {},
): Promise<GatherResult> {
  const f = { ...defaultFetchers, ...fetchers }
  const computedAt = Math.floor(Date.now() / 1000)
  const pocRpcSlugs = new Set(
    spec.credentials.filter((c) => c.poc && c.tier === 'rpc').map((c) => c.slug),
  )

  const [chainResult, github, speedrun, verifiedBuilder] = await Promise.all([
    f.chains(address, pocRpcSlugs),
    f.github(githubHandle),
    f.speedrun(address),
    f.verifiedBuilder(address),
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
