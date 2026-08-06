import { describe, it, expect } from 'vitest'
import {
  scorePath,
  inputPath,
  verifyPath,
  credentialsPath,
  absoluteUrl,
  verifyWalletPath,
  attestationsPath,
  SITE_ORIGIN,
} from '@/lib/routes'

const WALLET = '0x33041027dd8F4dC82B6e825FB37ADf8f15d44053'

describe('scorePath', () => {
  it('builds the results path without a handle', () => {
    expect(scorePath(WALLET, null)).toBe(`/score/${WALLET}`)
  })

  it('appends the github handle as a query param', () => {
    expect(scorePath(WALLET, 'octocat')).toBe(`/score/${WALLET}?github=octocat`)
  })

  it('treats empty and whitespace-only handles as absent', () => {
    expect(scorePath(WALLET, '')).toBe(`/score/${WALLET}`)
    expect(scorePath(WALLET, '   ')).toBe(`/score/${WALLET}`)
  })

  it('URL-encodes the handle', () => {
    expect(scorePath(WALLET, 'a b')).toBe(`/score/${WALLET}?github=a%20b`)
  })
})

describe('inputPath', () => {
  it('is bare /score with no prefill', () => {
    expect(inputPath(null, null)).toBe('/score')
  })

  it('is bare /score when called with no arguments', () => {
    expect(inputPath()).toBe('/score')
  })

  it('carries wallet and github prefill params', () => {
    expect(inputPath(WALLET, 'octocat')).toBe(`/score?wallet=${WALLET}&github=octocat`)
  })

  it('omits empty values', () => {
    expect(inputPath(WALLET, '')).toBe(`/score?wallet=${WALLET}`)
    expect(inputPath('', 'octocat')).toBe('/score?github=octocat')
    expect(inputPath('  ', null)).toBe('/score')
  })
})

describe('attestationsPath', () => {
  it('is the latest-attestations page', () => {
    expect(attestationsPath()).toBe('/attestations')
  })
})

describe('verifyPath', () => {
  it('is bare /verify with no uid', () => {
    expect(verifyPath()).toBe('/verify')
    expect(verifyPath(null)).toBe('/verify')
  })

  it('builds the deep link with a uid', () => {
    const uid = `0x${'ab'.repeat(32)}`
    expect(verifyPath(uid)).toBe(`/verify/${uid}`)
  })
})

describe('extra wallets', () => {
  it('scorePath without extras is unchanged', () => {
    expect(scorePath('0xabc', null)).toBe('/score/0xabc')
    expect(scorePath('0xabc', 'octocat', [])).toBe('/score/0xabc?github=octocat')
  })
  it('scorePath appends comma-separated wallets', () => {
    expect(scorePath('0xabc', null, ['0xdef', '0x123'])).toBe('/score/0xabc?wallets=0xdef,0x123')
    expect(scorePath('0xabc', 'octocat', ['0xdef'])).toBe(
      '/score/0xabc?github=octocat&wallets=0xdef',
    )
  })
  it('scorePath drops blank extras', () => {
    expect(scorePath('0xabc', null, [' ', ''])).toBe('/score/0xabc')
  })
  it('inputPath without extras is unchanged', () => {
    expect(inputPath()).toBe('/score')
    expect(inputPath('0xabc', 'octocat')).toBe('/score?wallet=0xabc&github=octocat')
  })
  it('inputPath carries extras', () => {
    expect(inputPath('0xabc', null, ['0xdef', '0x123'])).toBe(
      '/score?wallet=0xabc&wallets=0xdef%2C0x123',
    )
  })
})

describe('credentialsPath', () => {
  it('returns the bare page path', () => {
    expect(credentialsPath()).toBe('/credentials')
  })

  it('appends a slug anchor for deep links', () => {
    expect(credentialsPath('github_forks')).toBe('/credentials#github_forks')
  })
})

describe('verifyWalletPath', () => {
  // An attestation cannot contain a link to itself: EAS hashes both the data and
  // block.timestamp into the UID. Keying on the recipient wallet is the closest
  // thing that is fully known before the record exists, and it lands on the
  // verify view rather than starting a fresh scoring run.
  it('builds a wallet-keyed verify path', () => {
    expect(verifyWalletPath('0x33041027dd8F4dC82B6e825FB37ADf8f15d44053')).toBe(
      '/verify/wallet/0x33041027dd8F4dC82B6e825FB37ADf8f15d44053',
    )
  })

  it('does not collide with the uid route', () => {
    expect(verifyWalletPath('0xabc')).not.toBe(verifyPath('0xabc'))
  })

  it('is absolute-able for the onchain field', () => {
    expect(absoluteUrl(verifyWalletPath('0xabc'))).toBe(
      'https://talentprotocol.com/verify/wallet/0xabc',
    )
  })
})

describe('absolute URLs', () => {
  // These are the URLs that leave the app — shared links, OG metadata, and the
  // schema description written onchain. They must not depend on the origin the
  // page happens to be served from, which is why the domain is hardcoded.
  it('builds verify links on the canonical production origin', () => {
    expect(SITE_ORIGIN).toBe('https://talentprotocol.com')
    expect(absoluteUrl(verifyPath(`0x${'ab'.repeat(32)}`))).toBe(
      `https://talentprotocol.com/verify/0x${'ab'.repeat(32)}`,
    )
  })

  it('has no trailing slash to double up on the path', () => {
    expect(SITE_ORIGIN.endsWith('/')).toBe(false)
    expect(absoluteUrl('/verify')).toBe('https://talentprotocol.com/verify')
  })

  it('passes an already-absolute URL through untouched', () => {
    expect(absoluteUrl('https://example.com/x')).toBe('https://example.com/x')
  })
})
