# Consolidate fmt12 / fmtDuration into fmt.ts

## Goal

Remove duplicated time-formatting helpers across the dashboard renderers.

## Context

`fmt12` (12-hour clock) and `fmtDuration` ("25m" / "1h 5m") are copy-pasted in three
files: `src/views/dashboard/day-bar.ts`, `src/views/dashboard/sessions.ts`, and
`src/views/dashboard/pie.ts` (fmtDuration only). Meanwhile `src/views/dashboard/fmt.ts`
already houses the other shared formatters (`fmtHoursMinutes`, `fmtMinutes`). The
duplicates can drift independently.

## Approach

Move `fmt12` and `fmtDuration` into `src/views/dashboard/fmt.ts` (export them), then import
in `day-bar.ts`, `sessions.ts`, and `pie.ts` and delete the local copies. No behavior change.
Add a quick vitest for `fmt12` / `fmtDuration` while they're in `fmt.ts` (pure functions).

## Acceptance

- `fmt12` and `fmtDuration` defined once, in `fmt.ts`; no other file declares them.
- `npm run build` and `npm test` pass; dashboard + sessions render unchanged.
