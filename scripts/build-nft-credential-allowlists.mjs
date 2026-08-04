#!/usr/bin/env node
// Builds public/nft-credentials/<slug>/<shard>.json from the token history of
// the Devfolio and Base Basecamp collections.
//
//   node scripts/build-nft-credential-allowlists.mjs
//   node scripts/build-nft-credential-allowlists.mjs --only=base_basecamp
//
// Why a generated allowlist rather than a live read, and why not the Talent
// export either:
//
// These credentials need more than balanceOf. Telling a Devfolio winner from a
// participant needs the token's metadata; Basecamp's attendee SBTs are
// ERC-1155, so balanceOf reverts. Neither is a single call a browser can
// afford per wallet.
//
// The two Encode credentials are deliberately absent. Blockscout serves 8,910
// of that contract's 14,432 tokens and reports 2,894 holders when a sweep of
// its own data finds 2,923 — neither number can check the other — and the RPC
// path is 14k tokens plus 14k gateway fetches per run. It stays deferred in
// spec.json rather than shipping on a source none of this can validate.
//
// Talent Protocol indexes exactly this in wallet_nfts, but that index is
// scoped to wallets attached to a profile that has had a full refresh —
// 72,739 of 5,793,113 wallet accounts, 1.26%. Consuming it would hand a silent
// zero to everyone outside it, and these carry 80 points.
//
// So: rebuild from the chain. Every collection here was minted at an event
// that has already happened — the newest is Base Batches 2025 — so the sets do
// not grow, and a frozen list stays correct rather than decaying. This is
// public data: anyone can re-run this script and get the same answer, which is
// what the Builder Score and Builder Rewards snapshots can never be.
//
// Source is Blockscout's token-instance API, which returns the current owner
// and the parsed token metadata together. No API key, same as
// build-talent-token-allowlist.mjs.
//
// The rules below are lifted from the services Talent scores with
// (app/services/data_points/{devfolio_hackathons_won,base_devfolio_hackathons_won,
// base_basecamp}.rb) so this cannot award points production would not.

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'nft-credentials')
const MANIFEST = join(ROOT, 'spec', 'nft-credentials.json')
// Gateway fetches are the slowest part of a build; persisting them makes a
// re-run cheap and lets an interrupted one resume instead of starting over.
const CACHE_DIR = join(ROOT, 'tmp', 'nft-metadata-cache')

const EXPLORERS = {
  'base-mainnet': 'https://base.blockscout.com',
  'arb-mainnet': 'https://arbitrum.blockscout.com',
  'polygon-mainnet': 'https://polygon.blockscout.com',
  'opt-mainnet': 'https://optimism.blockscout.com',
}

// Only used to adjudicate a 404 from the explorer — see
// resolveMissingContract. Same endpoints and same fallback order as
// CHAIN_CONFIG in src/lib/chains.ts, because the public ones come and go:
// polygon-rpc.com currently answers curl but 401s everything else.
const RPCS = {
  'base-mainnet': ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'],
  'arb-mainnet': ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'],
  'polygon-mainnet': ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  'opt-mainnet': ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'],
}

const PAGE_DELAY_MS = 150
const MAX_RETRIES = 4

// --- the rules, mirrored from production ------------------------------------

// DataPoints::DevfolioHackathonsWon / BaseDevfolioHackathonsWon: a raw trait
// match, no normalisation on either side.
function devfolioWinner(metadata) {
  return (metadata?.attributes ?? []).some(
    (a) => a?.trait_type === 'nft_type' && a?.value === 'WINNER',
  )
}

// --- what each credential counts --------------------------------------------
// `unit` names what a wallet accumulates one of, and must match the `value`
// field in spec.json: a distinct contract, or a distinct programme name.

const DEVFOLIO = [
  ['base-mainnet', '0x2cb02ffcad9d09a08a365e7fffd166ebb369318c'],
  ['base-mainnet', '0x7abe24c1568031401b2d0bad7d752779d22b1ffa'],
  ['base-mainnet', '0x49a650e8f1054b556bce815b12eff7dd8d9eeeaf'],
  ['arb-mainnet', '0x2d06b90ec8a3082adea993d99bc6e354fac78b04'],
  ['arb-mainnet', '0x93fd88df3e2a377c0f23bf22c1cfd87047818d20'],
  ['arb-mainnet', '0xc051abb005ccf2eec5836a03f08591c22c2f3273'],
  ['arb-mainnet', '0xe34494de41383fbad7d1cdba6730d0e943425701'],
  ['arb-mainnet', '0x473a55f826b4805c779450a03d8ee7f79727af99'],
  ['arb-mainnet', '0x861f978a160270c495ff906db24afdb2199dcaf9'],
  ['arb-mainnet', '0x020c3a900fdbd33795d709e2b40a1f3510fbe1fc'],
  ['polygon-mainnet', '0x752ceec57492edb08a733284e372362c6d2ea385'],
]

const CREDENTIALS = [
  {
    slug: 'devfolio_hackathons_won',
    unit: 'contract',
    contracts: DEVFOLIO,
    match: devfolioWinner,
  },
  {
    slug: 'base_devfolio_hackathons_won',
    unit: 'contract',
    contracts: [
      ['base-mainnet', '0x91f311e31319fe79d6aca4a898cd6a00e12c3d23'],
      ['base-mainnet', '0x59ca61566c03a7fb8e4280d97bfa2e8e691da3a6'],
      ['base-mainnet', '0x98d9d7b9556ebc8be8f10cd5b7148e9c8adf744e'],
    ],
    match: devfolioWinner,
  },
  {
    // Ownership alone — the reason this one was ever blocked is ERC-1155,
    // not metadata.
    slug: 'base_basecamp',
    unit: 'contract',
    ownershipOnly: true,
    contracts: [
      ['base-mainnet', '0x05df46564c489a92492400298c88f032c8c21e96'],
      ['base-mainnet', '0xfb81b3bdbebebcceb8b3a380858006cb1799ddad'],
    ],
    match: () => true,
  },
]

// --- fetching ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': 'open-builder-score' } })
    if (response.ok) return response.json()
    // 429 and 5xx are worth waiting out; a 404 means the contract is not
    // indexed and no amount of retrying changes that.
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`${response.status} for ${url}`)
    }
    await sleep(500 * 2 ** attempt)
  }
  throw new Error(`gave up after ${MAX_RETRIES} attempts: ${url}`)
}

const query = (params) =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

// Every page of a Blockscout collection endpoint, following next_page_params.
async function* pages(base, path) {
  let params = null
  while (true) {
    const url = `${base}${path}${params ? `?${query(params)}` : ''}`
    const body = await getJson(url)
    yield body.items ?? []
    if (!body.next_page_params) return
    params = body.next_page_params
    await sleep(PAGE_DELAY_MS)
  }
}

// Ownership only, no metadata needed: ask the contract for its holders and
// stop. The alternative — walking instances and asking each for its holders —
// costs one request per token id, and Basecamp 002 is an ERC-1155 that minted
// a distinct id per attendee, so that is ~600 requests for an answer this
// endpoint gives in nine.
async function* contractHolders(base, address) {
  for await (const items of pages(base, `/api/v2/tokens/${address}/holders`)) {
    for (const holder of items) {
      const hash = holder?.address?.hash
      if (hash) yield { owner: hash.toLowerCase(), metadata: null }
    }
  }
}

// ERC-721 carries the current owner on the instance itself, alongside the
// parsed metadata — one sweep gives both. ERC-1155 instances have no single
// owner, so ownership there is the holder list of each instance; only reach
// for that when the metadata is actually needed to decide.
async function* tokenHolders(base, address) {
  for await (const items of pages(base, `/api/v2/tokens/${address}/instances`)) {
    for (const item of items) {
      const owner = item?.owner?.hash
      if (owner) {
        yield { owner: owner.toLowerCase(), metadata: item.metadata }
        continue
      }
      for await (const holders of pages(
        base,
        `/api/v2/tokens/${address}/instances/${item.id}/holders`,
      )) {
        for (const holder of holders) {
          const hash = holder?.address?.hash
          if (hash) yield { owner: hash.toLowerCase(), metadata: item.metadata }
        }
      }
    }
  }
}

// --- build -------------------------------------------------------------------

// --- RPC fallback, for contracts the explorer does not index ----------------
// ETHernals is an EIP-1167 minimal proxy (45 bytes of code), which Blockscout's
// Polygon instance does not classify as a token — so it 404s despite holding
// 261 real ERC-721s. The contract is ERC721Enumerable, so it can be walked
// directly instead.

// Gateways rate-limit and drop requests, and a dropped fetch reads exactly
// like a token that does not qualify. Try several, then account for what still
// failed — see the metadataFailures check in rpcTokenHolders.
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
]
const SELECTORS = {
  totalSupply: '0x18160ddd',
  tokenByIndex: '0x4f6ccce7',
  ownerOf: '0x6352211e',
  tokenURI: '0xc87b56dd',
}
const word = (n) => BigInt(n).toString(16).padStart(64, '0')

function decodeString(hex) {
  if (!hex || hex === '0x') return null
  const bytes = Buffer.from(hex.slice(2), 'hex')
  const length = parseInt(bytes.subarray(32, 64).toString('hex'), 16)
  return bytes.subarray(64, 64 + length).toString('utf8')
}

// One HTTP round trip per 50 calls rather than per call: 261 tokens needs
// three reads each, and serially that is 783 requests.
const RPC_BATCH = 100
const RPC_DELAY_MS = 40

/**
 * @param allowRevert whether a JSON-RPC error entry is a real answer.
 *
 * It is for ownerOf — a burned token genuinely has no owner. It is NOT for
 * tokenByIndex over a valid index range, where an error means the node
 * declined the call. Accepting those as answers is how 14,432 token ids
 * collapsed to 7,600 distinct values: every failed call became `null`, and
 * `BigInt(null ?? '0x0')` is token 0.
 */
async function batchCall(rpcs, address, calls, { allowRevert = false } = {}) {
  const results = new Array(calls.length)
  let size = RPC_BATCH
  let start = 0

  while (start < calls.length) {
    const chunk = calls.slice(start, start + size)
    const payload = chunk.map((data, i) => ({
      jsonrpc: '2.0',
      id: start + i,
      method: 'eth_call',
      params: [{ to: address, data }, 'latest'],
    }))

    let batch
    for (const rpc of rpcs) {
      try {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        })
        const body = await response.json()
        if (Array.isArray(body)) {
          batch = body
          break
        }
      } catch {
        // try the next endpoint
      }
    }
    if (!batch) throw new Error(`no RPC accepted a batch for ${address}`)

    // An entry that came back carrying an `error` is a real answer: ownerOf
    // reverts for a burned token, and that token genuinely has no owner. Only
    // an id that never came back at all means the node truncated the batch.
    // Conflating the two either drops live tokens or loops forever shrinking.
    const answered = new Set()
    for (const entry of batch) {
      if (typeof entry?.id !== 'number') continue
      if (entry.result !== undefined) {
        answered.add(entry.id)
        results[entry.id] = entry.result
      } else if (allowRevert) {
        answered.add(entry.id)
        results[entry.id] = null
      }
      // else: an error where none is expected — leave it unanswered so the
      // shrink-and-retry below picks it up.
    }

    // Nodes silently cap how many calls they will answer in one batch — a
    // 200-call payload came back half empty, and without this check those
    // tokens read as ownerless and vanished from the result. Shrink and retry
    // the same window rather than accept a short answer.
    const short = chunk.some((_, i) => !answered.has(start + i))
    if (short) {
      if (size > 25) {
        size = Math.max(25, Math.floor(size / 4))
        continue
      }
      throw new Error(
        `${address}: RPC would not answer every call even at batch size ${size} — refusing to build from partial reads`,
      )
    }

    start += chunk.length
    await sleep(RPC_DELAY_MS)
  }
  return results
}

const metadataCache = new Map()
const cachePath = (uri) => join(CACHE_DIR, `${createHash('sha1').update(uri).digest('hex')}.json`)

async function fetchMetadata(uri) {
  if (!uri) return { ok: false }
  if (metadataCache.has(uri)) return metadataCache.get(uri)

  try {
    const cached = JSON.parse(await readFile(cachePath(uri), 'utf8'))
    const hit = { ok: true, metadata: cached }
    metadataCache.set(uri, hit)
    return hit
  } catch {
    // not cached yet
  }

  const result = await fetchMetadataUncached(uri)
  // Only a success is worth remembering; a failure should be retried.
  if (result.ok) {
    metadataCache.set(uri, result)
    try {
      await writeFile(cachePath(uri), JSON.stringify(result.metadata))
    } catch {
      // a cache that cannot be written is not a reason to fail the build
    }
  }
  return result
}

async function fetchMetadataUncached(uri) {
  // A tokenURI that already names a gateway is still just a CID behind a host,
  // and those hosts rate-limit — gateway.pinata.cloud answers 429 in bulk.
  // Pull the CID out and treat every gateway as a candidate, original first.
  const cid = uri.startsWith('ipfs://') ? uri.slice(7) : uri.match(/\/ipfs\/(.+)$/)?.[1]
  const candidates = cid
    ? [...new Set([...(uri.startsWith('ipfs://') ? [] : [uri]), ...IPFS_GATEWAYS.map((g) => g + cid)])]
    : [uri]

  for (let round = 0; round < 2; round++) {
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          headers: { 'user-agent': 'open-builder-score' },
          signal: AbortSignal.timeout(20_000),
        })
        if (response.ok) return { ok: true, metadata: await response.json() }
      } catch {
        // next gateway
      }
    }
    await sleep(1_000 * (round + 1))
  }
  return { ok: false }
}

async function* rpcTokenHolders(chain, address) {
  const rpcs = RPCS[chain]
  const [supplyHex] = await batchCall(rpcs, address, [SELECTORS.totalSupply])
  const supply = Number(BigInt(supplyHex ?? '0x0'))
  // Not every collection is ERC721Enumerable — Base Around The World has no
  // totalSupply at all. Distinct error so the caller can tell "no second path
  // exists" from "the second path failed".
  if (!supply) throw new Error(`NOT_ENUMERABLE: ${address} on ${chain} has no readable totalSupply`)

  const ids = (
    await batchCall(
      rpcs,
      address,
      Array.from({ length: supply }, (_, i) => SELECTORS.tokenByIndex + word(i)),
    )
  ).map((hex) => BigInt(hex))

  // Every index in 0..totalSupply-1 names a distinct token. Duplicates mean
  // reads were lost and quietly folded together, which no downstream check
  // would catch.
  const distinct = new Set(ids.map(String)).size
  if (distinct !== ids.length) {
    throw new Error(
      `${address} on ${chain}: tokenByIndex returned ${distinct} distinct ids for ${ids.length} indices — reads were lost`,
    )
  }

  console.log(`    ${supply} tokens enumerated, reading owners…`)
  const owners = await batchCall(rpcs, address, ids.map((id) => SELECTORS.ownerOf + word(id)), {
    allowRevert: true,
  })
  console.log(`    owners read, reading token URIs…`)
  const uris = await batchCall(rpcs, address, ids.map((id) => SELECTORS.tokenURI + word(id)))
  console.log(`    URIs read, fetching metadata (cached per distinct URI)…`)

  // Metadata is one HTTP fetch per token and the gateway is the slow part, so
  // run a few at a time rather than serially.
  const CONCURRENCY = 40
  let failures = 0
  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const slice = ids.slice(start, start + CONCURRENCY).map((_, offset) => start + offset)
    const fetched = await Promise.all(slice.map((i) => fetchMetadata(decodeString(uris[i]))))
    for (let n = 0; n < slice.length; n++) {
      const i = slice[n]
      const ownerHex = owners[i]
      if (!ownerHex || ownerHex === '0x') continue
      if (!fetched[n].ok) failures++
      yield { owner: `0x${ownerHex.slice(26)}`.toLowerCase(), metadata: fetched[n].metadata ?? null }
    }
  }

  // An unreachable gateway and a token that does not qualify are
  // indistinguishable downstream — both contribute nothing. Publishing on a
  // run where the metadata largely failed would quietly zero real holders, so
  // refuse rather than guess.
  if (failures > 0) {
    const pct = ((failures / ids.length) * 100).toFixed(1)
    const message = `${address} on ${chain}: ${failures}/${ids.length} (${pct}%) metadata fetches failed`
    if (failures / ids.length > 0.02) throw new Error(`${message} — refusing to publish a partial result`)
    console.warn(`  WARNING ${message}`)
  }
}

/**
 * A 404 from the explorer has two very different causes, and guessing wrong
 * corrupts the result in opposite directions. If nothing is deployed at the
 * address the contract can never contribute and skipping it is exact. If the
 * contract is real and merely unindexed, skipping it silently under-counts
 * every wallet that holds one — so that case has to stop the build.
 *
 * eth_getCode settles it.
 */
async function resolveMissingContract(chain, address) {
  const rpcs = RPCS[chain]
  if (!rpcs) throw new Error(`no RPC configured for ${chain} to adjudicate ${address}`)

  let code
  const failures = []
  for (const rpc of rpcs) {
    try {
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getCode',
          params: [address, 'latest'],
        }),
      })
      const body = await response.json()
      if (typeof body?.result === 'string') {
        code = body.result
        break
      }
      failures.push(`${rpc}: ${body?.error?.message ?? `HTTP ${response.status}`}`)
    } catch (error) {
      failures.push(`${rpc}: ${error.message}`)
    }
  }

  // Never guess. Not knowing whether the contract exists is a reason to stop,
  // not a reason to skip it — skipping a real contract under-counts silently.
  if (code === undefined) {
    throw new Error(`could not reach any ${chain} RPC to adjudicate ${address}:\n  ${failures.join('\n  ')}`)
  }
  return code === '0x' || code === '0x0' ? 'no contract' : 'unindexed contract'
}

// The chain's own token count, when the contract will give one. This is the
// only reference here that does not come from the explorer, which matters
// because the explorer can be wrong in both directions at once: the Encode
// contract (not built here, see the header) serves 8,910 of 14,432 tokens AND
// reports 2,894 holders when a sweep of its own data finds 2,923. Checking an
// explorer's output against its own count proves nothing.
async function chainTotalSupply(chain, address) {
  try {
    const [hex] = await batchCall(RPCS[chain], address, [SELECTORS.totalSupply])
    const supply = Number(BigInt(hex ?? '0x0'))
    return Number.isFinite(supply) && supply > 0 ? supply : null
  } catch {
    return null
  }
}

// The explorer's own headline numbers, used to prove a sweep was complete.
async function tokenSummary(base, address) {
  try {
    const body = await getJson(`${base}/api/v2/tokens/${address}`)
    const holders = Number(body?.holders ?? body?.holders_count ?? 0)
    return { holders: Number.isFinite(holders) ? holders : 0 }
  } catch {
    return { holders: 0 }
  }
}

async function buildCredential(credential) {
  // wallet → set of distinct units (contracts or programme names). A Set is
  // the whole point: production uniq's before counting, so two winner tokens
  // from one hackathon are one win.
  const units = new Map()
  const perContract = {}
  const incomplete = []
  let tokens = 0

  // One contract's results, kept apart until they are known to be complete.
  // Merging as we go would make a short sweep impossible to undo — the units
  // for a name-based credential are programme names, not the contract, so
  // there is no way to tell afterwards which contract contributed them.
  async function sweep(source) {
    const owners = new Map()
    // Every owner the sweep saw, qualifying or not. Completeness has to be
    // judged on this, never on `owners`: only 116 of Base Around The World's
    // 694 holders hold a WINNER token, and comparing winners against holders
    // reads a complete sweep as 83% truncated.
    const allOwners = new Set()
    let seen = 0
    for await (const { owner, metadata } of source) {
      seen++
      allOwners.add(owner)
      const unit = credential.name
        ? credential.name(metadata)
        : credential.match(metadata)
          ? address
          : null
      if (!unit) continue
      if (!owners.has(owner)) owners.set(owner, new Set())
      owners.get(owner).add(unit)
    }
    return { owners, seen, allOwners }
  }

  let address
  for (const [chain, addr] of credential.contracts) {
    address = addr
    const base = EXPLORERS[chain]
    if (!base) throw new Error(`no explorer configured for ${chain}`)

    let result
    let via = 'explorer'

    try {
      // `ownershipOnly` credentials never look at metadata, so the cheap
      // contract-level holder list answers them exactly.
      result = await sweep(
        credential.ownershipOnly ? contractHolders(base, address) : tokenHolders(base, address),
      )
    } catch (error) {
      if (!/^404 /.test(error.message)) throw error

      // The explorer does not have it. Skipping is only safe if there is
      // genuinely nothing deployed; a real contract has to be read another
      // way, or every one of its holders is silently under-counted.
      const verdict = await resolveMissingContract(chain, address)
      if (verdict === 'no contract') {
        perContract[address] = { chain, tokens: 0, qualifying: 0, skipped: 'no contract deployed' }
        console.log(`  ${chain} ${address}: SKIPPED — no contract deployed`)
        continue
      }
      console.log(`  ${chain} ${address}: explorer has no token record — reading over RPC`)
      result = await sweep(rpcTokenHolders(chain, address))
      via = 'rpc (explorer has no token record)'
    }

    // The instances endpoint stops paginating early on large collections and
    // the wallets holding the rest simply vanish — nothing in the response
    // admits it. Check the sweep against the chain, and against the explorer's
    // holder count when the contract reports no supply, then redo over RPC.
    if (via === 'explorer') {
      // Prefer the chain: if the contract reports a totalSupply, a sweep that
      // returned fewer tokens than that is short no matter what the explorer
      // claims about holders.
      const supply = await chainTotalSupply(chain, address)
      if (supply && result.seen < supply * 0.98) {
        console.log(
          `  ${chain} ${address}: swept ${result.seen} of ${supply} tokens on chain — re-reading over RPC`,
        )
        result = await sweep(rpcTokenHolders(chain, address))
        via = 'rpc (explorer sweep was short vs chain totalSupply)'
      }

      const { holders } = await tokenSummary(base, address)
      // Tolerance, not equality: the explorer's holder count drifts by a
      // wallet or two against a live sweep, and on a 27-holder collection one
      // wallet is 3.7% — tight percentage thresholds turn that into a false
      // alarm. Absolute slack covers small sets, the percentage covers large.
      const shortfall = holders - result.allOwners.size
      if (via === 'explorer' && holders > 0 && shortfall > Math.max(2, holders * 0.02)) {
        console.log(
          `  ${chain} ${address}: swept ${result.allOwners.size} of ${holders} holders — re-reading over RPC`,
        )
        try {
          result = await sweep(rpcTokenHolders(chain, address))
          via = 'rpc (explorer sweep was short)'
        } catch (error) {
          if (!error.message.startsWith('NOT_ENUMERABLE')) throw error
          // No second way to read this contract. Publishing quietly would ship
          // a credential that under-counts with nothing recording it, so the
          // shortfall goes in the manifest and the verifier fails on it.
          incomplete.push({ address, chain, swept: result.allOwners.size, holders })
          console.warn(
            `  WARNING ${chain} ${address}: swept ${result.allOwners.size} of ${holders} holders and the contract is not enumerable — marking INCOMPLETE`,
          )
          via = 'explorer (incomplete)'
        }
      }
    }

    for (const [owner, set] of result.owners) {
      if (!units.has(owner)) units.set(owner, new Set())
      for (const unit of set) units.get(owner).add(unit)
    }

    tokens += result.seen
    const qualifying = [...result.owners.values()].reduce((n, set) => n + set.size, 0)
    perContract[address] = {
      chain,
      tokens: result.seen,
      owners: result.owners.size,
      ...(via === 'explorer' ? {} : { source: via }),
    }
    console.log(
      `  ${chain} ${address}: ${result.seen} tokens, ${result.allOwners.size} owners, ${result.owners.size} qualifying` +
        (via === 'explorer' ? '' : ` [${via}]`),
    )
    void qualifying
  }

  const values = new Map()
  for (const [wallet, set] of units) values.set(wallet, set.size)
  return { values, perContract, tokens, incomplete }
}

function shardKey(address) {
  return address.replace(/^0x/, '').slice(0, 2)
}

async function writeShards(slug, values) {
  const dir = join(OUT_DIR, slug)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const shards = new Map()
  for (let i = 0; i < 256; i++) shards.set(i.toString(16).padStart(2, '0'), {})
  for (const [wallet, count] of values) shards.get(shardKey(wallet))[wallet] = count

  // Every shard is written, including the empty ones: a 404 has to mean
  // "couldn't check", so an absent shard must never stand in for a zero.
  for (const [key, body] of shards) {
    await writeFile(join(dir, `${key}.json`), JSON.stringify(body))
  }
}

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
  const wanted = only ? CREDENTIALS.filter((c) => c.slug === only) : CREDENTIALS
  if (wanted.length === 0) throw new Error(`unknown credential: ${only}`)

  const manifest = {
    generated_at: new Date().toISOString().slice(0, 10),
    source: 'Blockscout token instances (public, reproducible)',
    generator: 'scripts/build-nft-credential-allowlists.mjs',
    frozen_because:
      'every collection was minted at an event that has already happened, so the holder sets do not grow',
    shards: 256,
    credentials: {},
  }

  for (const credential of wanted) {
    console.log(`\n${credential.slug}`)
    const { values, perContract, tokens, incomplete } = await buildCredential(credential)
    await writeShards(credential.slug, values)
    manifest.credentials[credential.slug] = {
      unit: credential.unit,
      wallets: values.size,
      tokens_scanned: tokens,
      ...(incomplete.length ? { incomplete } : {}),
      contracts: perContract,
    }
    console.log(`  → ${values.size} wallets`)
  }

  // A partial run must not publish a manifest claiming the credentials it
  // skipped, so --only merges into whatever is already on disk.
  let existing = {}
  if (only) {
    try {
      existing = JSON.parse(await (await import('node:fs/promises')).readFile(MANIFEST, 'utf8'))
    } catch {
      existing = {}
    }
    manifest.credentials = { ...(existing.credentials ?? {}), ...manifest.credentials }
  }

  await mkdir(dirname(MANIFEST), { recursive: true })
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`\nmanifest → ${MANIFEST}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
