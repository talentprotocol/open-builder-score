import type { CredentialInput } from './types'

export const GITHUB_SLUGS = [
  'github_account_age',
  'github_followers',
  'github_stars',
  'github_forks',
  'github_repositories',
] as const

const API = 'https://api.github.com'
const MAX_REPO_PAGES = 20

export function aggregateRepoStats(repos: unknown[]): { stars: number; forks: number } {
  let stars = 0
  let forks = 0
  for (const repo of repos) {
    if (typeof repo !== 'object' || repo === null) continue
    const r = repo as { stargazers_count?: unknown; forks_count?: unknown }
    if (typeof r.stargazers_count === 'number') stars += r.stargazers_count
    if (typeof r.forks_count === 'number') forks += r.forks_count
  }
  return { stars, forks }
}

function allSlugs(input: CredentialInput): Record<string, CredentialInput> {
  return Object.fromEntries(GITHUB_SLUGS.map((slug) => [slug, input]))
}

export async function readGithubCredentials(
  handle: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, CredentialInput>> {
  if (!handle) return allSlugs({ status: 'ok', accounts: [] })

  try {
    const userResponse = await fetchFn(`${API}/users/${encodeURIComponent(handle)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (userResponse.status === 404) {
      return allSlugs({ status: 'unavailable', reason: 'GitHub user not found' })
    }
    if (userResponse.status === 403 || userResponse.status === 429) {
      return allSlugs({
        status: 'unavailable',
        reason: 'GitHub rate limit exceeded — try again in an hour',
      })
    }
    if (!userResponse.ok) {
      return allSlugs({ status: 'unavailable', reason: `GitHub API error (${userResponse.status})` })
    }
    const user = (await userResponse.json()) as {
      created_at: string
      followers: number
      public_repos: number
    }

    const repos: unknown[] = []
    for (let page = 1; page <= MAX_REPO_PAGES; page++) {
      const pageResponse = await fetchFn(
        `${API}/users/${encodeURIComponent(handle)}/repos?per_page=100&page=${page}`,
        { headers: { Accept: 'application/vnd.github+json' } },
      )
      if (!pageResponse.ok) {
        return allSlugs({
          status: 'unavailable',
          reason:
            pageResponse.status === 403 || pageResponse.status === 429
              ? 'GitHub rate limit exceeded — try again in an hour'
              : `GitHub API error (${pageResponse.status})`,
        })
      }
      const pageRepos = (await pageResponse.json()) as unknown[]
      repos.push(...pageRepos)
      if (pageRepos.length < 100) break
    }
    const { stars, forks } = aggregateRepoStats(repos)

    return {
      github_account_age: { status: 'ok', accounts: [Math.floor(Date.parse(user.created_at) / 1000)] },
      github_followers: { status: 'ok', accounts: [user.followers] },
      github_stars: { status: 'ok', accounts: [stars] },
      github_forks: { status: 'ok', accounts: [forks] },
      github_repositories: { status: 'ok', accounts: [user.public_repos] },
    }
  } catch {
    return allSlugs({ status: 'unavailable', reason: 'GitHub API unreachable' })
  }
}
