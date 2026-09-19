# ee-first-modern

[![CI](https://github.com/Crynspier/ee-first-modern/actions/workflows/ci.yml/badge.svg)](https://github.com/Crynspier/ee-first-modern/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ee-first-modern)](https://www.npmjs.com/package/ee-first-modern)
[![npm downloads](https://img.shields.io/npm/dm/ee-first-modern)](https://www.npmjs.com/package/ee-first-modern)

**A tiny, dependency-free, TypeScript-first first-event primitive for Node.js.**

A modern, maintained implementation of the `ee-first` pattern: wait for the **first event across multiple events and emitters**, return the winner, and clean up all losing listeners.

## Why this exists

Node.js provides useful lower-level event primitives such as `EventEmitter.once()` and `events.once()`, but they wait for a particular event on a particular emitter. The operation this package focuses on is different:

> Wait for whichever of several events fires first, potentially across multiple emitters, then remove all of the other listeners.

That is the small abstraction `ee-first` provides, and it is still useful when coordinating things such as request completion, socket closure, abort/error races, and competing lifecycle events.

`ee-first-modern` preserves the established callback API while adding a modern package/tooling surface:

- ESM and CommonJS
- first-party TypeScript types
- Promise API
- `AbortSignal` cancellation
- zero runtime dependencies
- cleanup and registration-safety checks

## Why use this instead of `ee-first`?

The original `ee-first` package is a long-established dependency. This project is intended for code that wants the same small primitive with modern packaging and APIs without pulling in the old implementation.

| Capability | `ee-first` 1.1.x | `ee-first-modern` |
| --- | ---: | ---: |
| Callback API | Yes | Yes |
| Callable waiter | Yes | Yes |
| `.cancel()` | Yes | Yes |
| ESM | No | Yes |
| CommonJS | Yes | Yes |
| First-party TypeScript | No | Yes |
| Promise API | No | Yes |
| `AbortSignal` | No | Yes |
| Runtime dependencies | 0 | 0 |

The compatibility target is the public callback behavior and callable waiter shape. The modern APIs are additive.

## Install

```sh
npm install ee-first-modern
```

## Callback API

```js
import first from 'ee-first-modern'

const waiter = first([
  [request, 'close', 'error'],
  [response, 'finish'],
], (error, emitter, event, args) => {
  // All registered listeners have already been removed.
})

waiter.cancel()
```

The callback receives:

```text
(error, emitter, event, args)
```

For a non-`error` event, `error` is `null`. For an `error` event, it is the event's first argument.

The returned waiter is callable for compatibility with the historical API, so a pending callback can be replaced:

```js
waiter(nextCallback)
```

## Promise API

```js
import { firstAsync } from 'ee-first-modern'

const result = await firstAsync([
  [request, 'close', 'error'],
  [response, 'finish'],
])

console.log(result.event, result.emitter, result.args)
```

By default, an `error` event rejects the Promise. Use `rejectOnError: false` to receive an `error` event as a normal result.

## AbortSignal

```js
import { firstAsync } from 'ee-first-modern'

const controller = new AbortController()

const promise = firstAsync(
  [[socket, 'close', 'error']],
  { signal: controller.signal },
)

controller.abort('request cancelled')
```

Aborting removes the registered listeners and rejects with `FirstAbortedError`. A non-`undefined` abort reason is available as `error.cause`.

The callback API also accepts `{ signal }`; aborting cancels the waiter without invoking the callback.

## Supported emitter shape

An emitter must provide:

- `.on(event, listener)`
- `.removeListener(event, listener)` or `.off(event, listener)`

String and symbol event names are supported.

## Quality

The repository includes:

- compatibility and edge-case tests
- registration rollback and cleanup checks
- randomized listener-leak testing
- ESM/CommonJS coverage
- type-level API tests
- benchmark harness
- Node 18/20/22/24 CI
- zero runtime dependencies

Run locally:

```sh
npm install
npm run check
npm run bench
```

## Links

- [npm](https://www.npmjs.com/package/ee-first-modern)
- [GitHub](https://github.com/Crynspier/ee-first-modern)

## License

MIT
