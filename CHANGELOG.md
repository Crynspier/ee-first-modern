# Changelog

## 0.1.3 - 2026-09-20

### Fixed

- Corrected callback and Promise result typing so `error` may be `undefined` for an `'error'` event emitted without arguments, matching runtime compatibility behavior.
- Hardened cleanup of the internal `AbortSignal` listener when a non-standard signal throws from `removeEventListener()`.
- Combined event-listener and AbortSignal cleanup failures with `AggregateError` when both fail.
- Retained a failed AbortSignal listener removal so a later callback waiter `.cancel()` can retry cleanup.
- Fixed the cancellation retry guard so a retained AbortSignal cleanup is retried even when all emitter listener removals already succeeded.
- Distinguished an actual thrown `undefined` failure from the absence of a failure throughout cleanup, callback, and registration error handling without changing the 0.1.3 package version.

### Added

- Regression coverage for signal cleanup failures and retry behavior.
- Regression coverage for simultaneous emitter and AbortSignal cleanup failures.
- Regression coverage for thrown `undefined` failures in cleanup, callback, Promise, cancellation, and registration paths.
- Regression coverage for abort cleanup failures producing `AggregateError`.
- Coverage for emitters that expose only `.off()`.
- Coverage for `.removeListener()` taking precedence over `.off()`.
- Coverage for custom listener `this` values.
- Public API type checks.

### Documentation

- Documented the `undefined` error value for argument-less `'error'` events.
- Documented synchronous custom-emitter registration behavior.
- Documented cleanup precedence between `.removeListener()` and `.off()`.

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
