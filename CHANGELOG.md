# Changelog

## 0.1.2 - 2026-09-20

### Fixed

- Replaced the separately maintained CommonJS implementation with a generated build from the TypeScript source.
- Made ESM and CommonJS behavior originate from the same implementation.
- Preserved the historical callable CommonJS export shape while exposing the named APIs.
- Added ESM/CommonJS parity tests covering callbacks, cancellation, Promise behavior, abort handling, registration failures, cleanup failures, retryable cleanup, synchronous emitters, and symbol events.
- Ensured cleanup failures and AggregateError behavior are identical across package formats.
- Added regression coverage for already-aborted signals before listener registration.
- Added regression coverage for Promise settlement when listener cleanup throws.

## 0.1.1 - 2026-09-20

### Fixed

- Hardened callback and Promise cleanup behavior when a custom emitter's removeListener() or off() throws.
- firstAsync() now always settles when listener cleanup fails instead of potentially remaining pending.
- Combined event/cleanup failures are surfaced as AggregateError when both failures exist.
- Callback completion now runs before surfacing a cleanup failure.
- Failed listener removals are retained so a later .cancel() can retry cleanup.
- Already-aborted callback signals are detected before any event listeners are registered.
- Corrected FirstResult.error typing to reflect its null non-error-event value.

## 0.1.0 - 2026-09-20

Initial release candidate with the established callback API plus ESM, CommonJS, TypeScript, Promise, and AbortSignal support.
