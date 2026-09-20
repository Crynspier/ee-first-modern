export type EventName = string | symbol

export interface EventEmitterLike {
  on(event: EventName, listener: (...args: unknown[]) => void): unknown
  removeListener?(event: EventName, listener: (...args: unknown[]) => void): unknown
  off?(event: EventName, listener: (...args: unknown[]) => void): unknown
}

export type EventSpec = readonly [EventEmitterLike, ...EventName[]]

export type FirstCallback = (
  error: unknown | null | undefined,
  emitter: EventEmitterLike,
  event: EventName,
  args: unknown[],
) => void

export interface FirstResult {
  error: unknown | null | undefined
  emitter: EventEmitterLike
  event: EventName
  args: unknown[]
}

export interface FirstOptions {
  signal?: AbortSignal
}

export interface FirstWaiter {
  (done: FirstCallback): void
  cancel(): void
}

export interface FirstPromiseOptions extends FirstOptions {
  rejectOnError?: boolean
}

export class FirstAbortedError extends Error {
  readonly name = 'AbortError'
  readonly code = 'ABORT_ERR'

  constructor(message = 'The first-event wait was aborted') {
    super(message)
  }
}

type CleanupEntry = {
  emitter: EventEmitterLike
  event: EventName
  listener: (...args: unknown[]) => void
}

interface Failure {
  failed: boolean
  error: unknown
}

const noFailure = (): Failure => ({
  failed: false,
  error: undefined,
})

const failure = (error: unknown): Failure => ({
  failed: true,
  error,
})

interface Registration {
  cancel(): Failure
}

interface Completion {
  result: FirstResult
  cleanup: Failure
}

function validateSpecs(stuff: readonly EventSpec[]): void {
  if (!Array.isArray(stuff)) {
    throw new TypeError('arg must be an array of [ee, events...] arrays')
  }

  for (const spec of stuff) {
    if (!Array.isArray(spec) || spec.length < 2) {
      throw new TypeError('each array member must be [ee, events...]')
    }

    const emitter = spec[0]

    if (!emitter || typeof emitter.on !== 'function') {
      throw new TypeError('event emitter must expose an .on(event, listener) method')
    }

    if (typeof emitter.removeListener !== 'function' && typeof emitter.off !== 'function') {
      throw new TypeError('event emitter must expose .removeListener() or .off() for cleanup')
    }
  }
}

function removeListener(
  emitter: EventEmitterLike,
  event: EventName,
  listener: (...args: unknown[]) => void,
): void {
  if (typeof emitter.removeListener === 'function') {
    emitter.removeListener(event, listener)
    return
  }

  if (typeof emitter.off === 'function') {
    emitter.off(event, listener)
    return
  }

  throw new TypeError('event emitter must expose .removeListener() or .off() for cleanup')
}

/**
 * Attempts every removal. Entries whose remover throws remain registered so a
 * later cancel() can retry cleanup. Throwing undefined is treated as a real
 * failure rather than as "no error".
 */
function cleanupEntries(entries: CleanupEntry[]): Failure {
  let firstFailure: Failure = noFailure()
  const remaining: CleanupEntry[] = []

  for (const entry of entries) {
    try {
      removeListener(entry.emitter, entry.event, entry.listener)
    } catch (error) {
      remaining.push(entry)
      if (!firstFailure.failed) firstFailure = failure(error)
    }
  }

  entries.splice(0, entries.length, ...remaining)
  return firstFailure
}

function combineFailures(
  primary: Failure,
  secondary: Failure,
  message: string,
): Failure {
  if (!secondary.failed) return primary
  if (!primary.failed) return secondary

  return failure(new AggregateError([primary.error, secondary.error], message))
}

function abortError(signal?: AbortSignal): FirstAbortedError {
  const reason = signal?.reason

  if (reason instanceof FirstAbortedError) return reason

  const error = new FirstAbortedError(
    reason instanceof Error ? reason.message : 'The first-event wait was aborted',
  )

  if (reason !== undefined) {
    ;(error as Error & { cause?: unknown }).cause = reason
  }

  return error
}

function cancelledWaiter(): FirstWaiter {
  const waiter = ((_nextDone: FirstCallback): void => {}) as FirstWaiter
  waiter.cancel = () => {}
  return waiter
}

function setupFirst(
  stuff: readonly EventSpec[],
  signal: AbortSignal | undefined,
  onEvent: (completion: Completion) => void,
  onAbort: (cleanup: Failure) => void,
): Registration {
  validateSpecs(stuff)

  const cleanups: CleanupEntry[] = []
  let settled = false
  let abortHandler: (() => void) | undefined

  const cleanup = (): Failure => {
    const listenerCleanup = cleanupEntries(cleanups)
    let abortCleanup = noFailure()

    if (abortHandler && signal) {
      try {
        signal.removeEventListener('abort', abortHandler)
        abortHandler = undefined
      } catch (error) {
        // Keep the handler reference so a later cancel() can retry removal.
        abortCleanup = failure(error)
      }
    }

    return combineFailures(
      listenerCleanup,
      abortCleanup,
      'Event listener and AbortSignal cleanup both failed',
    )
  }

  const complete = (
    error: unknown | null | undefined,
    emitter: EventEmitterLike,
    event: EventName,
    args: unknown[],
  ): void => {
    if (settled) return

    settled = true
    const cleanupResult = cleanup()

    onEvent({
      result: { error, emitter, event, args },
      cleanup: cleanupResult,
    })
  }

  const addListener = (emitter: EventEmitterLike, event: EventName): void => {
    if (settled) return

    const listener = function (this: EventEmitterLike | undefined, ...args: unknown[]): void {
      const error = event === 'error' ? args[0] : null
      complete(error, this ?? emitter, event, args.slice())
    }

    // Register cleanup before calling user/custom emitter code. This prevents
    // synchronous emitters from winning before their own listener is tracked.
    cleanups.push({ emitter, event, listener })
    emitter.on(event, listener)
  }

  if (signal?.aborted) {
    settled = true
    return {
      cancel: () => noFailure(),
    }
  }

  if (signal) {
    abortHandler = () => {
      if (settled) return

      settled = true
      const cleanupResult = cleanup()
      onAbort(cleanupResult)
    }

    signal.addEventListener('abort', abortHandler, { once: true })
  }

  try {
    for (const spec of stuff) {
      const [emitter, ...events] = spec

      for (const event of events) {
        addListener(emitter, event)
      }
    }
  } catch (error) {
    const cleanupResult = cleanup()
    throw combineFailures(
      failure(error),
      cleanupResult,
      'Event listener registration and cleanup both failed',
    ).error
  }

  return {
    cancel: (): Failure => {
      // If an earlier cleanup failed, allow a later cancel() to retry the
      // remaining removals even though the waiter has logically settled.
      if (cleanups.length === 0 && !abortHandler && settled) return noFailure()

      settled = true
      return cleanup()
    },
  }
}

export default function first(
  stuff: readonly EventSpec[],
  done: FirstCallback,
  options: FirstOptions = {},
): FirstWaiter {
  if (typeof done !== 'function') {
    throw new TypeError('listener must be a function')
  }

  if (options.signal?.aborted) {
    validateSpecs(stuff)
    return cancelledWaiter()
  }

  let callback = done

  let registration!: Registration
  registration = setupFirst(
    stuff,
    options.signal,
    ({ result, cleanup }) => {
      let callbackFailure = noFailure()

      try {
        callback(result.error, result.emitter, result.event, result.args)
      } catch (error) {
        callbackFailure = failure(error)
      }

      const combined = combineFailures(
        callbackFailure,
        cleanup,
        'Event callback and listener cleanup both failed',
      )

      if (combined.failed) throw combined.error
    },
    () => {
      // Callback APIs have no error channel for asynchronous cancellation.
      // Cancellation is therefore intentionally silent.
    },
  )

  const waiter = ((nextDone: FirstCallback): void => {
    if (typeof nextDone !== 'function') {
      throw new TypeError('listener must be a function')
    }

    callback = nextDone
  }) as FirstWaiter

  waiter.cancel = (): void => {
    const cleanupResult = registration.cancel()

    if (cleanupResult.failed) {
      throw cleanupResult.error
    }
  }

  return waiter
}

export function firstAsync(
  stuff: readonly EventSpec[],
  options: FirstPromiseOptions = {},
): Promise<FirstResult> {
  return new Promise<FirstResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      validateSpecs(stuff)
      reject(abortError(options.signal))
      return
    }

    try {
      setupFirst(
        stuff,
        options.signal,
        ({ result, cleanup }) => {
          if (cleanup.failed) {
            const primary =
              result.event === 'error' && options.rejectOnError !== false
                ? failure(result.error ?? new Error('The first event was error'))
                : noFailure()

            reject(
              combineFailures(
                primary,
                cleanup,
                'The first event occurred, but listener cleanup failed',
              ).error,
            )
            return
          }

          if (result.event === 'error' && options.rejectOnError !== false) {
            reject(result.error ?? new Error('The first event was error'))
          } else {
            resolve(result)
          }
        },
        (cleanup) => {
          const combined = combineFailures(
            failure(abortError(options.signal)),
            cleanup,
            'Aborting the first-event wait also failed to clean up a listener',
          )

          reject(combined.error)
        },
      )
    } catch (error) {
      reject(error)
    }
  })
}

export { first }
