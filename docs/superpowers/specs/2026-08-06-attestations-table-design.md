# Attestations table UI

**Date:** 2026-08-06  
**Status:** Approved

## Problem

`/attestations` renders a dense inline list. Sparse content leaves the footer mid-viewport. Users need scannable columns plus light client-side sort and pagination.

## Design

### Layout

- Keep `max-w-3xl` chrome.
- `main` is `flex flex-1 flex-col` so it fills between header and footer; footer stays at the bottom when content is short.
- Header stays at top; content region below is `flex-1` (loading / error / empty / table).

### Table

Columns: **Recipient** · **Score** · **Date** · **Verify**

- Native `<table>` with `thead` / `tbody`, hairline borders, muted header labels.
- Recipient: shortened mono address. Score: `{n} pts`. Date: `YYYY-MM-DD`. Verify: link to `/verify/[uid]`.

### Sorting (client-side)

- Default: Date descending (matches easscan fetch order).
- Sortable headers: **Date** and **Score** only (toggle asc/desc).
- Active column shows ↑/↓.
- Changing sort resets to page 1.

### Pagination (client-side)

- Page size **10** over the fetched set (`LATEST_TAKE` ≈ 20).
- Controls under the table: `from–to of N` + Prev / Next (disabled at ends).
- Hidden when empty or only one page.

### States

Loading / error / empty copy unchanged; those panels stretch in the `flex-1` region.

## Out of scope

Server-side `skip`, URL query sync, Wallets/Spec columns, row click (Verify link only).
