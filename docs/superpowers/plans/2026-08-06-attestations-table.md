# Attestations table implementation plan

> **For agentic workers:** Implement task-by-task. Steps use checkboxes.

**Goal:** Replace the `/attestations` list with a full-height table (Recipient / Score / Date / Verify), client-side Date/Score sorting, and 10-per-page pagination.

**Spec:** `docs/superpowers/specs/2026-08-06-attestations-table-design.md`

## File map

| File | Role |
|------|------|
| `src/lib/attestations-table.ts` | Pure sort + paginate helpers |
| `test/attestations-table.test.ts` | Unit tests for helpers |
| `src/app/attestations/page.tsx` | Table UI, sort/pagination state, full-height shell |

### Task 1: Sort + paginate helpers (TDD)

- [x] Add `sortAttestations(items, key, dir)` — keys `date` | `score`; default callers use `date`/`desc`
- [x] Add `paginateAttestations(items, page, pageSize=10)` — returns `{ page, totalPages, total, items, from, to }`
- [x] Changing sort is page-level; helpers stay pure
- [x] Tests: sort by score/date both dirs; paginate page 1/2; empty list; page clamp

### Task 2: Page UI

- [x] Full-height `main` + `flex-1` content region
- [x] Table with sortable Date/Score headers; Recipient + Verify static
- [x] Pagination controls; hide when ≤1 page
- [x] Loading / error / empty stretch in content region
- [x] Sort change resets page to 1

### Task 3: Verify

- [x] `npx vitest run test/attestations-table.test.ts`
- [ ] Manual: `/attestations` fills viewport with footer at bottom; sort + page work
