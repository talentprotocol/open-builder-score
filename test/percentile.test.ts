import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import specJson from '../spec/spec.json'
import {
  computePercentile,
  CORPUS_MAX_PAGES,
  CORPUS_PAGE_SIZE,
  fetchScorePercentile,
  latestPerWallet,
  parseCorpusPage,
  type CorpusEntry,
} from '@/lib/percentile'

const PARAMS = parseAbiParameters(
  'string spec_version,address wallet,address[] extra_wallets,bytes[] ownership_proofs,bytes recipient_ownership_proof,uint64 proofs_issued_at,string github_handle,uint16 score,uint64 computed_at,uint64 block_number,string verify_url,string[] badges',
)

// Solo records — N=1 aggregates — unless extras are passed; the corpus keeps
// solo rows only, so multi-wallet fixtures exercise the exclusion.
function encodedData(
  score: number,
  specVersion: string = specJson.version,
  extras: `0x${string}`[] = [],
): `0x${string}` {
  return encodeAbiParameters(PARAMS, [
    specVersion,
    '0x0000000000000000000000000000000000000001',
    extras,
    extras.map(() => `0x${'11'.repeat(65)}` as `0x${string}`),
    '0x',
    0n,
    '',
    score,
    1n,
    2n,
    '',
    [],
  ])
}

function row(
  recipient: string,
  score: number,
  timeCreated: number,
  specVersion?: string,
  extras: `0x${string}`[] = [],
) {
  return { id: `uid-${recipient}-${timeCreated}`, recipient, timeCreated, data: encodedData(score, specVersion, extras) }
}

function pageResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ data: { attestations: rows } }), { status: 200 })
}

const entry = (recipient: string, score: number, timeCreated: number, specVersion: string = specJson.version): CorpusEntry => ({
  recipient,
  score,
  specVersion,
  timeCreated,
})

describe('parseCorpusPage', () => {
  it('keeps solo rows only — multi-wallet aggregates are not like-for-like', () => {
    const raw = {
      data: {
        attestations: [
          row('0xaaa', 100, 1),
          row('0xbbb', 200, 2, undefined, ['0x00000000000000000000000000000000000000A1' as `0x${string}`]),
        ],
      },
    }
    const entries = parseCorpusPage(raw)!
    expect(entries.map((e) => e.recipient)).toEqual(['0xaaa'])
  })

  it('parses rows and lowercases recipients', () => {
    const parsed = parseCorpusPage({ data: { attestations: [row('0xAbC0000000000000000000000000000000000001', 141, 10)] } })
    expect(parsed).toEqual([entry('0xabc0000000000000000000000000000000000001', 141, 10)])
  })
  it('skips junk rows and undecodable data, keeps the rest', () => {
    const parsed = parseCorpusPage({
      data: {
        attestations: [
          42,
          { id: 'x', recipient: '0xA', data: '0xdeadbeef' },
          row('0xB', 103, 5),
        ],
      },
    })
    expect(parsed).toEqual([entry('0xb', 103, 5)])
  })
  it('returns null on a malformed root', () => {
    expect(parseCorpusPage(null)).toBeNull()
    expect(parseCorpusPage({ data: {} })).toBeNull()
    expect(parseCorpusPage({ errors: [{ message: 'nope' }] })).toBeNull()
  })
})

describe('latestPerWallet', () => {
  it('keeps only the newest score per wallet', () => {
    expect(
      latestPerWallet([entry('0xa', 103, 5), entry('0xa', 141, 10), entry('0xb', 20, 7)]).sort((x, y) => x - y),
    ).toEqual([20, 141])
  })
  it('drops entries from other spec versions', () => {
    expect(latestPerWallet([entry('0xa', 141, 10), entry('0xb', 999, 20, '9.9.9')])).toEqual([141])
  })
})

describe('computePercentile', () => {
  it('returns null for an empty corpus', () => {
    expect(computePercentile(141, [], false)).toBeNull()
  })
  it('counts strictly below — ties are not beaten', () => {
    expect(computePercentile(141, [103, 141, 200], false)).toEqual({
      countBelow: 1,
      corpusSize: 3,
      topPercent: 67,
      truncated: false,
    })
  })
  it('floors topPercent at 1 when above everyone', () => {
    const scores = Array.from({ length: 200 }, (_, i) => i)
    expect(computePercentile(999, scores, true)).toEqual({
      countBelow: 200,
      corpusSize: 200,
      topPercent: 1,
      truncated: true,
    })
  })
})

describe('fetchScorePercentile', () => {
  it('single short page: ok, not truncated', async () => {
    const calls: string[] = []
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(String(init?.body))
      return pageResponse([row('0xA', 141, 10), row('0xB', 103, 5)])
    }) as typeof fetch
    const result = await fetchScorePercentile(120, fakeFetch)
    expect(result).toEqual({
      status: 'ok',
      percentile: { countBelow: 1, corpusSize: 2, topPercent: 50, truncated: false },
    })
    expect(calls).toHaveLength(1)
  })
  it('paginates until a short page', async () => {
    const fullPage = Array.from({ length: CORPUS_PAGE_SIZE }, (_, i) => row(`0xfull${i}`, i, 1000 + i))
    let call = 0
    const fakeFetch = (async () => {
      call++
      return call === 1 ? pageResponse(fullPage) : pageResponse([row('0xlast', 50, 1)])
    }) as typeof fetch
    const result = await fetchScorePercentile(0, fakeFetch)
    expect(call).toBe(2)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.percentile.corpusSize).toBe(CORPUS_PAGE_SIZE + 1)
      expect(result.percentile.truncated).toBe(false)
    }
  })
  it('cap hit: consults the count query and reports truncation honestly', async () => {
    let pageCalls = 0
    let countCalls = 0
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body)
      if (body.includes('aggregateAttestation')) {
        countCalls++
        return new Response(
          JSON.stringify({ data: { aggregateAttestation: { _count: { _all: 9999 } } } }),
          { status: 200 },
        )
      }
      pageCalls++
      const base = pageCalls * 100000
      return pageResponse(
        Array.from({ length: CORPUS_PAGE_SIZE }, (_, i) => row(`0xp${pageCalls}n${i}`, 10, base + i)),
      )
    }) as typeof fetch
    const result = await fetchScorePercentile(999, fakeFetch)
    expect(pageCalls).toBe(CORPUS_MAX_PAGES)
    expect(countCalls).toBe(1)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.percentile.corpusSize).toBe(CORPUS_MAX_PAGES * CORPUS_PAGE_SIZE)
      expect(result.percentile.truncated).toBe(true)
    }
  })
  it('empty corpus maps to empty', async () => {
    const fakeFetch = (async () => pageResponse([])) as typeof fetch
    expect(await fetchScorePercentile(141, fakeFetch)).toEqual({ status: 'empty' })
  })
  it('HTTP and network failures map to error', async () => {
    const httpFail = (async () => new Response('{}', { status: 500 })) as typeof fetch
    expect(await fetchScorePercentile(141, httpFail)).toEqual({ status: 'error' })
    const netFail = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    expect(await fetchScorePercentile(141, netFail)).toEqual({ status: 'error' })
  })
})
