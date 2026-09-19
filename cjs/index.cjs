'use strict'

class FirstAbortedError extends Error {
  constructor(message = 'The first-event wait was aborted') {
    super(message)
    this.name = 'AbortError'
    this.code = 'ABORT_ERR'
  }
}

function validateSpecs(stuff) {
  if (!Array.isArray(stuff)) throw new TypeError('arg must be an array of [ee, events...] arrays')
  for (const spec of stuff) {
    if (!Array.isArray(spec) || spec.length < 2) throw new TypeError('each array member must be [ee, events...]')
    const emitter = spec[0]
    if (!emitter || typeof emitter.on !== 'function') throw new TypeError('event emitter must expose an .on(event, listener) method')
    if (typeof emitter.removeListener !== 'function' && typeof emitter.off !== 'function') throw new TypeError('event emitter must expose .removeListener() or .off() for cleanup')
  }
}

function removeListener(emitter, event, listener) {
  if (typeof emitter.removeListener === 'function') return emitter.removeListener(event, listener)
  if (typeof emitter.off === 'function') return emitter.off(event, listener)
  throw new TypeError('event emitter must expose .removeListener() or .off() for cleanup')
}

function cleanupEntries(entries) {
  let firstError
  for (const entry of entries.splice(0)) {
    try { removeListener(entry.emitter, entry.event, entry.listener) }
    catch (error) { if (firstError === undefined) firstError = error }
  }
  return firstError
}

function abortError(signal) {
  const reason = signal && signal.reason
  if (reason instanceof FirstAbortedError) return reason
  const error = new FirstAbortedError(reason instanceof Error ? reason.message : 'The first-event wait was aborted')
  if (reason !== undefined) error.cause = reason
  return error
}

function first(stuff, done, options = {}) {
  validateSpecs(stuff)
  if (typeof done !== 'function') throw new TypeError('listener must be a function')

  const cleanups = []
  let settled = false
  let abortHandler

  const cleanup = () => {
    const error = cleanupEntries(cleanups)
    if (abortHandler && options.signal) {
      options.signal.removeEventListener('abort', abortHandler)
      abortHandler = undefined
    }
    if (error !== undefined) throw error
  }

  const complete = (error, emitter, event, args) => {
    if (settled) return
    settled = true
    cleanup()
    done(error, emitter, event, args)
  }

  const add = (emitter, event) => {
    if (settled) return
    const listener = function (...args) {
      complete(event === 'error' ? args[0] : null, this ?? emitter, event, args.slice())
    }
    cleanups.push({ emitter, event, listener })
    emitter.on(event, listener)
  }

  try {
    for (const spec of stuff) {
      const [emitter, ...events] = spec
      for (const event of events) add(emitter, event)
    }
  } catch (error) {
    try { cleanup() } catch {}
    throw error
  }

  if (options.signal) {
    if (options.signal.aborted) {
      settled = true
      try { cleanup() } catch {}
      const cancelled = (() => {})
      cancelled.cancel = () => {}
      return cancelled
    }

    abortHandler = () => {
      if (settled) return
      settled = true
      try { cleanup() } catch {}
    }
    options.signal.addEventListener('abort', abortHandler, { once: true })
  }

  const waiter = (nextDone) => {
    if (typeof nextDone !== 'function') throw new TypeError('listener must be a function')
    done = nextDone
  }
  waiter.cancel = () => {
    if (settled) return
    settled = true
    cleanup()
  }
  return waiter
}

function firstAsync(stuff, options = {}) {
  return new Promise((resolve, reject) => {
    let waiter
    let abortListener
    let settled = false

    const removeAbortListener = () => {
      if (abortListener && options.signal) {
        options.signal.removeEventListener('abort', abortListener)
        abortListener = undefined
      }
    }

    const settleAbort = () => {
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

    const onFirst = (error, emitter, event, args) => {
      if (settled) return
      settled = true
      removeAbortListener()
      const result = { error, emitter, event, args }
      if (event === 'error' && options.rejectOnError !== false) reject(error ?? new Error('The first event was error'))
      else resolve(result)
    }

    try { waiter = first(stuff, onFirst) }
    catch (error) { settled = true; reject(error); return }

    if (options.signal) {
      abortListener = settleAbort
      options.signal.addEventListener('abort', abortListener, { once: true })
      if (settled) removeAbortListener()
    }
  })
}

module.exports = Object.assign(first, { default: first, first, firstAsync, FirstAbortedError })
