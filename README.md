# ee-first-modern

A modern, dependency-free, TypeScript-first implementation of the `ee-first` first-event primitive.

## Why this exists

Node.js provides lower-level event primitives such as `EventEmitter.once()` and `events.once()`, but those wait for a particular event. This library coordinates several events across one or more emitters, returns the first winner, and removes all losing listeners.

The public callback shape is compatible with the established `ee-first` API, while this package adds ESM, CommonJS, first-party TypeScript types, a Promise API, and AbortSignal cancellation.

## Status

**0.1.0 — public release.** The package is production-ready for its intended first-event coordination use case.
