export type EventName = string | symbol

export interface EventEmitterLike {
  on(event: EventName, listener: (...args: unknown[]) => void): unknown
  removeListener?(event: EventName, listener: (...args: unknown[]) => void): unknown
  off?(event: EventName, listener: (...args: unknown[]) => void): unknown
}

export type EventSpec = readonly [EventEmitterLike, ...EventName[]]

export type FirstCallback = (
  error: unknown | null,
  emitter: EventEmitterLike,
  event: EventName,
  args: unknown[],
) => void

export interface FirstResult {
  error: unknown
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

function cleanupEntries(
  entries: Array<{
    emitter: EventEmitterLike
    event: EventName
    listener: (...args: unknown[]) => void
  }>,
): unknown | undefined {
  let firstError: unknown | undefined

  for (const entry of entries.splice(0)) {
    try {
      removeListener(entry.emitter, entry.event, entry.listener)
    } catch (error) {
      if (firstError === undefined) firstError = error
    }
  }

  return firstError
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

export default function first(
  stuff: readonly EventSpec[],
  done: FirstCallback,
  options: FirstOptions = {},
): FirstWaiter {
  validateSpecs(stuff)

  if (typeof done !== 'function') {
    throw new TypeError('listener must be a function')
  }

  const cleanups: Array<{
    emitter: EventEmitterLike
    event: EventName
    listener: (...args: unknown[]) => void
  }> = []

  let settled = false
  let abortHandler: (() => void) | undefined

  const cleanup = (): void => {
    const cleanupError = cleanupEntries(cleanups)

    if (abortHandler && options.signal) {
      options.signal.removeEventListener('abort', abortHandler)
      abortHandler = undefined
    }

    if (cleanupError !== undefined) throw cleanupError
  }

  const complete = (
    error: unknown | null,
    emitter: EventEmitterLike,
    event: EventName,
    args: unknown[],
  ): void => {
    if (settled) return

    settled = true
    cleanup()
    done(error, emitter, event, args)
  }

  const addListener = (emitter: EventEmitterLike, event: EventName): void => {
    if (settled) return

    const listener = function (this: EventEmitterLike | undefined, ...args: unknown[]): void {
      const error = event === 'error' ? args[0] : null
      complete(error, this ?? emitter, event, args.slice())
    }

    cleanups.push({ emitter, event, listener })
    emitter.on(event, listener)
  }

  try {
    for (const spec of stuff) {
      const [emitter, ...events] = spec
      for (const event of events) addListener(emitter, event)
    }
  } catch (error) {
    try {
      cleanup()
    } catch {
      // Preserve the original registration error.
    }
    throw error
  }

  if (options.signal) {
    if (options.signal.aborted) {
      settled = true

      try {
        cleanup()
      } catch {
        // Callback-style abort is best-effort cleanup.
      }

      const cancelled = (() => {}) as FirstWaiter
      cancelled.cancel = () => {}
      return cancelled
    }

    abortHandler = () => {
      if (settled) return

      settled = true

      try {
        cleanup()
      } catch {
        // Callback-style abort is best-effort cleanup.
      }
    }

    options.signal.addEventListener('abort', abortHandler, { once: true })
  }

  const waiter = ((nextDone: FirstCallback): void => {
    if (typeof nextDone !== 'function') {
      throw new TypeError('listener must be a function')
    }

    done = nextDone
  }) as FirstWaiter

  waiter.cancel = (): void => {
    if (settled) return

    settled = true
    cleanup()
  }

  return waiter
}

export function firstAsync(
  stuff: readonly EventSpec[],
  options: FirstPromiseOptions = {},
): Promise<FirstResult> {
  return new Promise<FirstResult>((resolve, reject) => {
    let waiter: FirstWaiter | undefined
    let abortListener: (() => void) | undefined
    let settled = false

    const removeAbortListener = (): void => {
      if (abortListener && options.signal) {
        options.signal.removeEventListener('abort', abortListener)
        abortListener = undefined
      }
    }

    const settleAbort = (): void => {
      if (settled) return

      settled = true
      waiter?.cancel()
      removeAbortListener()
      reject(abortError(options.signal))
    }

    if (options.signal?.aborted) {
      settleAbort()
      return
    }

    const onFirst: FirstCallback = (error, emitter, event, args) => {
      if (settled) return

      settled = true
      removeAbortListener()

      const result: FirstResult = { error, emitter, event, args }

      if (event === 'error' && options.rejectOnError !== false) {
        reject(error ?? new Error('The first event was error'))
      } else {
        resolve(result)
      }
    }

    try {
      waiter = first(stuff, onFirst)
    } catch (error) {
      settled = true
      reject(error)
      return
    }

    if (options.signal) {
      abortListener = settleAbort
      options.signal.addEventListener('abort', abortListener, { once: true })

      if (settled) removeAbortListener()
    }
  })
}

export { first }
