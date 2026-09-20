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

type CleanupError = unknown | undefined

interface Registration {
  cancel(): CleanupError
}

interface Completion {
  result: FirstResult
  cleanupError: CleanupError
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
 * later cancel() can retry cleanup. The first failure is returned.
 */
function cleanupEntries(entries: CleanupEntry[]): CleanupError {
  let firstError: unknown | undefined
  const remaining: CleanupEntry[] = []

  for (const entry of entries) {
    try {
      removeListener(entry.emitter, entry.event, entry.listener)
    } catch (error) {
      remaining.push(entry)
      if (firstError === undefined) firstError = error
    }
  }

  entries.splice(0, entries.length, ...remaining)
  return firstError
}

function combineErrors(primary: unknown, secondary: unknown, message: string): unknown {
  if (secondary === undefined) return primary
  if (primary === undefined) return secondary
  return new AggregateError([primary, secondary], message)
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
  onAbort: (cleanupError: CleanupError) => void,
): Registration {
  validateSpecs(stuff)

  const cleanups: CleanupEntry[] = []
  let settled = false
  let abortHandler: (() => void) | undefined

  const cleanup = (): CleanupError => {
    const cleanupError = cleanupEntries(cleanups)
    let abortCleanupError: CleanupError

    if (abortHandler && signal) {
      try {
        signal.removeEventListener('abort', abortHandler)
        abortHandler = undefined
      } catch (error) {
        // Keep the handler reference so a later cancel() can retry removal.
        abortCleanupError = error
      }
    }

    return combineErrors(
      cleanupError,
      abortCleanupError,
      'Event listener and AbortSignal cleanup both failed',
    )
  }

  const complete = (
    error: unknown | null,
    emitter: EventEmitterLike,
    event: EventName,
    args: unknown[],
  ): void => {
    if (settled) return

    settled = true
    const cleanupError = cleanup()

    onEvent({
      result: { error, emitter, event, args },
      cleanupError,
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
      cancel: () => undefined,
    }
  }

  if (signal) {
    abortHandler = () => {
      if (settled) return

      settled = true
      const cleanupError = cleanup()
      onAbort(cleanupError)
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
    const cleanupError = cleanup()
    throw combineErrors(error, cleanupError, 'Event listener registration and cleanup both failed')
  }

  return {
    cancel: (): CleanupError => {
      // If an earlier cleanup failed, allow a later cancel() to retry the
      // remaining removals even though the waiter has logically settled.
      if (cleanups.length === 0 && settled) return undefined

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
    ({ result, cleanupError }) => {
      let callbackError: unknown | undefined

      try {
        callback(result.error, result.emitter, result.event, result.args)
      } catch (error) {
        callbackError = error
      }

      const error = combineErrors(
        callbackError,
        cleanupError,
        'Event callback and listener cleanup both failed',
      )

      if (error !== undefined) throw error
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
    const cleanupError = registration.cancel()

    if (cleanupError !== undefined) {
      throw cleanupError
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
        ({ result, cleanupError }) => {
          if (cleanupError !== undefined) {
            const primary =
              result.event === 'error' && options.rejectOnError !== false
                ? result.error ?? new Error('The first event was error')
                : undefined

            reject(
              combineErrors(
                primary ?? undefined,
                cleanupError,
                'The first event occurred, but listener cleanup failed',
              ),
            )
            return
          }

          if (result.event === 'error' && options.rejectOnError !== false) {
            reject(result.error ?? new Error('The first event was error'))
          } else {
            resolve(result)
          }
        },
        (cleanupError) => {
          const error = abortError(options.signal)

          reject(
            combineErrors(
              error,
              cleanupError,
              'Aborting the first-event wait also failed to clean up a listener',
            ),
          )
        },
      )
    } catch (error) {
      reject(error)
    }
  })
}

export { first }
