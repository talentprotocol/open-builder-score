import { describe, it, expect } from 'vitest'
import { nftShardPath, readNftCredential, nftCredentialSlugs } from '@/lib/nft-credentials'

const A = `0xC8B74c37Bd25E6ca8CB6DDf2E01058C45D341182`
const shard = 'c8'

const respond = (body: unknown, ok = true, status = 200) =>
  (async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch

describe('nftShardPath', () => {
  it('shards on the two hex characters after 0x, case-insensitively', () => {
    expect(nftShardPath('devfolio_hackathons_won', A)).toBe(
      `/nft-credentials/devfolio_hackathons_won/${shard}.json`,
    )
    expect(nftShardPath('devfolio_hackathons_won', A.toLowerCase())).toBe(
      `/nft-credentials/devfolio_hackathons_won/${shard}.json`,
    )
  })

  it('refuses anything that is not an EVM address', () => {
    expect(() => nftShardPath('devfolio_hackathons_won', '0xnope')).toThrow()
  })
})

describe('readNftCredential', () => {
  const slug = nftCredentialSlugs[0]

  it('reads the wallet’s count out of its shard', async () => {
    const result = await readNftCredential(slug, A, respond({ [A.toLowerCase()]: 3 }))
    expect(result).toEqual({ status: 'ok', accounts: [3] })
  })

  it('scores zero for a wallet the shard does not list', async () => {
    // The shard loaded and simply does not name this wallet — that is a real
    // zero, not a failure to look.
    const result = await readNftCredential(slug, A, respond({ '0xdead': 1 }))
    expect(result).toEqual({ status: 'ok', accounts: [0] })
  })

  // The distinction the whole feature rests on. These credentials carry 80
  // points; a shard that will not load has to read as "couldn't check", or a
  // network blip silently understates a real builder while the score still
  // reports itself complete.
  it('reports unavailable — never zero — when the shard cannot be read', async () => {
    const missing = await readNftCredential(slug, A, respond({}, false, 404))
    expect(missing.status).toBe('unavailable')

    const threw = await readNftCredential(slug, A, (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect(threw.status).toBe('unavailable')
  })

  it('rejects a shard whose shape is wrong rather than reading it as zero', async () => {
    expect((await readNftCredential(slug, A, respond([1, 2, 3]))).status).toBe('unavailable')
    expect((await readNftCredential(slug, A, respond({ [A.toLowerCase()]: 'two' }))).status).toBe(
      'unavailable',
    )
  })

  it('reports unavailable for a slug the manifest does not carry', async () => {
    const result = await readNftCredential('encode_programmes_won', A, respond({}))
    expect(result).toMatchObject({ status: 'unavailable' })
  })
})

describe('the shipped manifest', () => {
  it('carries exactly the credentials the generator builds', () => {
    expect([...nftCredentialSlugs].sort()).toEqual([
      'base_basecamp',
      'base_devfolio_hackathons_won',
      'devfolio_hackathons_won',
    ])
  })
})
