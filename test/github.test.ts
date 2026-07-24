import { describe, it, expect } from 'vitest'
import { aggregateRepoStats, readGithubCredentials, GITHUB_SLUGS } from '@/lib/github'

const userPayload = {
  created_at: '2020-04-25T18:00:00Z',
  followers: 170,
  public_repos: 16,
}
const repoPage = [
  { stargazers_count: 40, forks_count: 30 },
  { stargazers_count: 24, forks_count: 19 },
]

function fakeFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.entries(routes).find(([key]) => url.includes(key))
    if (!match) throw new Error(`unexpected fetch: ${url}`)
    const { status, body } = match[1]
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }) as typeof fetch
}

describe('aggregateRepoStats', () => {
  it('sums stargazers and forks', () => {
    expect(aggregateRepoStats(repoPage)).toEqual({ stars: 64, forks: 49 })
  })
  it('ignores malformed entries', () => {
    expect(aggregateRepoStats([...repoPage, null, 'x', {}])).toEqual({ stars: 64, forks: 49 })
  })
})

describe('readGithubCredentials', () => {
  it('returns empty ok inputs when no handle is given', async () => {
    const result = await readGithubCredentials(null)
    for (const slug of GITHUB_SLUGS) {
      expect(result[slug]).toEqual({ status: 'ok', accounts: [] })
    }
  })

  it('maps the five metrics from the API payloads', async () => {
    const result = await readGithubCredentials('octocat', fakeFetch({
      '/users/octocat/repos': { status: 200, body: repoPage },
      '/users/octocat': { status: 200, body: userPayload },
    }))
    expect(result.github_account_age).toEqual({
      status: 'ok',
      accounts: [Math.floor(Date.parse('2020-04-25T18:00:00Z') / 1000)],
    })
    expect(result.github_followers).toEqual({ status: 'ok', accounts: [170] })
    expect(result.github_stars).toEqual({ status: 'ok', accounts: [64] })
    expect(result.github_forks).toEqual({ status: 'ok', accounts: [49] })
    expect(result.github_repositories).toEqual({ status: 'ok', accounts: [16] })
  })

  it('maps 404 to user-not-found on every slug', async () => {
    const result = await readGithubCredentials('nobody', fakeFetch({
      '/users/nobody': { status: 404, body: {} },
    }))
    for (const slug of GITHUB_SLUGS) {
      expect(result[slug]).toEqual({ status: 'unavailable', reason: 'GitHub user not found' })
    }
  })

  it('maps 403 to the rate-limit message', async () => {
    const result = await readGithubCredentials('octocat', fakeFetch({
      '/users/octocat': { status: 403, body: {} },
    }))
    expect(result.github_stars).toEqual({
      status: 'unavailable',
      reason: 'GitHub rate limit exceeded — try again in an hour',
    })
  })
})
