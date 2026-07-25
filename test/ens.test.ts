import { describe, it, expect } from 'vitest'
import { looksLikeEnsName, resolveEnsName, type EnsResolverFn } from '@/lib/ens'

const ADDRESS = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053' as const

describe('looksLikeEnsName', () => {
  it('accepts dotted names', () => {
    expect(looksLikeEnsName('vitalik.eth')).toBe(true)
    expect(looksLikeEnsName('sub.name.eth')).toBe(true)
  })
  it('rejects addresses, dotless strings, whitespace, and too-short values', () => {
    expect(looksLikeEnsName(ADDRESS)).toBe(false)
    expect(looksLikeEnsName('nodot')).toBe(false)
    expect(looksLikeEnsName('a b.eth')).toBe(false)
    expect(looksLikeEnsName('.e')).toBe(false)
  })
})

describe('resolveEnsName', () => {
  it('resolves via the injected resolver with a normalized name', async () => {
    let seen: string | null = null
    const resolver: EnsResolverFn = async (name) => {
      seen = name
      return ADDRESS
    }
    const result = await resolveEnsName('  Vitalik.eth ', resolver)
    expect(result).toEqual({ status: 'resolved', address: ADDRESS })
    expect(seen).toBe('vitalik.eth')
  })
  it('maps a null resolution to unresolved', async () => {
    const resolver: EnsResolverFn = async () => null
    expect(await resolveEnsName('nobody.eth', resolver)).toEqual({ status: 'unresolved' })
  })
  it('maps resolver failures to error', async () => {
    const resolver: EnsResolverFn = async () => {
      throw new Error('boom')
    }
    const result = await resolveEnsName('vitalik.eth', resolver)
    expect(result.status).toBe('error')
  })
  it('maps un-normalizable names to error without calling the resolver', async () => {
    let called = false
    const resolver: EnsResolverFn = async () => {
      called = true
      return null
    }
    const result = await resolveEnsName('ab..eth', resolver)
    expect(result.status).toBe('error')
    expect(called).toBe(false)
  })
})
