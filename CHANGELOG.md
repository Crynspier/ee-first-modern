# Changelog

## 0.1.1 - 2026-09-20

### Fixed

- Hardened callback and Promise cleanup behavior when a custom emitter's `removeListener()` or `off()` throws.
- `firstAsync()` now always settles when listener cleanup fails instead of potentially remaining pending.
- Combined event/cleanup failures are surfaced as `AggregateError` when both failures exist.
- Callback completion now runs before surfacing a cleanup failure.
- Failed listener removals are retained so a later `.cancel()` can retry cleanup.
- Already-aborted callback signals are detected before any event listeners are registered.
- Corrected `FirstResult.error` typing to reflect its `null` non-error-event value.

## 0.1.0 - 2026-09-20

Initial release candidate with the established callback API plus ESM, CommonJS, TypeScript, Promise, and AbortSignal support.
