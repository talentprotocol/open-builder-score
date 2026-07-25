'use client'

import { useSyncExternalStore } from 'react'
import {
  getGithubAuth,
  subscribeGithubAuth,
  type GithubAuth,
} from '@/lib/github-auth-store'

export function useGithubAuth(): GithubAuth | null {
  return useSyncExternalStore(subscribeGithubAuth, getGithubAuth, () => null)
}
