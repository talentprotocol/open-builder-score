# Percentile Among Attested Scores (Design)

**Date:** 2026-07-25
**Status:** Approved via roadmap delegation.

## Goal

Answer "where does this score sit among everyone who attested?" on the
results screen, computed in-browser from the public EAS index — no backend,
consistent with everything else in the app.

## Key decisions

1. **Corpus = latest non-revoked attestation per wallet, current spec version
   only.** A wallet that attested five times counts once (most recent);
   revoked attestations are excluded server-side
   (`revocationTime: { equals: 0 }`); older-spec scores aren't comparable and
   are filtered after decoding (`decoded.specVersion !== spec.version`).
2. **easscan GraphQL, two queries.** A paginated schema-wide `attestations`
   query (`take: 100`, `skip`, newest-first; hard cap 5 pages / 500 rows) and
   — the new bit the indexer offers — a cheap `aggregateAttestation`
   `_count` that runs only when the cap is hit, so the UI can honestly say
   "based on the most recent 500" only when there genuinely are more.
   Scores live ABI-encoded in `data`, so ranking must decode client-side —
   no server-side groupBy can do this.
3. **Strict-below ranking, ceil top-percent, floor at 1%.**
   `countBelow = scores strictly below yours`;
   `topPercent = max(1, ceil((corpusSize − countBelow) / corpusSize × 100))`.
   Ties don't count as beaten. Tiny corpora read honestly ("Higher than 0 of
   1 attested Builder Score · top 100%") — acceptable while the corpus grows.
4. **Quiet UI.** A self-fetching one-line component (pattern:
   `attestation-history.tsx`) under the address block on the results page:
   "Higher than N of M attested Builder Score(s) · top P%". Renders nothing
   while loading, on error, or when the corpus is empty. Compares the
   currently computed total (partial or not) against the corpus.

## Pieces

- `src/lib/percentile.ts` — `CORPUS_PAGE_QUERY`, `CORPUS_COUNT_QUERY`,
  `CORPUS_PAGE_SIZE = 100`, `CORPUS_MAX_PAGES = 5`; `parseCorpusPage`
  (tolerant, skips undecodable rows, lowercases recipients, null on
  malformed root); `latestPerWallet` (dedup + spec-version filter);
  `computePercentile` (pure); `fetchScorePercentile(myScore, fetchFn?)` →
  `ok { percentile } | empty | error`. Reuses `decodeAttestationData` +
  `EASSCAN_GRAPHQL` from `verify.ts` and `ATTEST_SCHEMA_UID` from `eas.ts`.
- `src/components/score-percentile.tsx` — `<ScorePercentile score={n} />`.
- `src/app/score/[wallet]/page.tsx` — render it after the address block.

## Out of scope

Caching the corpus, percentile on the verify page, charts/distribution UI,
multi-spec-version normalization.

## Constraints carried forward

No new dependencies; `verify.ts`, `history.ts`, `eas.ts`, engine and all
fetchers untouched; zinc + emerald; all 150 existing tests stay green; the
lib is unit-tested with injectable fetch (encode test fixtures with viem's
`encodeAbiParameters` against the real schema params). Mind the Turbopack
JSX gotcha: text that wraps to a new line after an `{expression}` loses its
leading space — keep continuation text on the same line as the expression or
use explicit `{' '}`.
