import { describe, it, expect } from 'vitest'
import { describeWalletError } from '@/lib/wallet-errors'

describe('describeWalletError', () => {
  it('maps a 4001 rejection to a neutral cancellation, with no technical detail', () => {
    const e = Object.assign(new Error('User rejected the request.'), { code: 4001 })
    expect(describeWalletError(e, 'sign')).toEqual({
      message: 'Cancelled in the wallet.',
      detail: null,
      cancelled: true,
    })
  })

  it('finds the rejection down a wagmi/viem cause chain', () => {
    const inner = Object.assign(new Error('User rejected the request.'), {
      name: 'UserRejectedRequestError',
    })
    const outer = Object.assign(new Error('request failed'), { cause: inner })
    expect(describeWalletError(outer, 'attest').cancelled).toBe(true)
  })

  it('never surfaces a raw revert as the headline', () => {
    const e = new Error('execution reverted: 0xdeadbeef ProviderRpcError blah blah')
    const info = describeWalletError(e, 'attest')
    expect(info.message).toBe('The attestation failed onchain. Nothing was spent besides gas. Try again.')
    expect(info.detail).toContain('execution reverted')
    expect(info.cancelled).toBe(false)
  })

  it('gives the switch action its manual-fallback message', () => {
    expect(describeWalletError(new Error('boom'), 'switch').message).toBe(
      "Couldn't switch to Base Sepolia — switch manually in your wallet and try again.",
    )
  })

  it('handles non-Error throwables', () => {
    const info = describeWalletError('nope', 'connect')
    expect(info.detail).toBeNull()
    expect(info.cancelled).toBe(false)
  })

  it('survives a cyclic cause chain', () => {
    const a: Record<string, unknown> = { message: 'a' }
    a.cause = a
    expect(describeWalletError(a, 'sign').cancelled).toBe(false)
  })
})
