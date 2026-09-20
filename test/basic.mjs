import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import esmFirst, { FirstAbortedError as ESMFirstAbortedError, firstAsync as esmFirstAsync } from '../dist/index.js'

const require = createRequire(import.meta.url)
const cjs = require('../dist/index.cjs')

const apis = [
  {
    name: 'ESM',
    first: esmFirst,
    firstAsync: esmFirstAsync,
    FirstAbortedError: ESMFirstAbortedError,
  },
  {
    name: 'CJS',
    first: cjs,
    firstAsync: cjs.firstAsync,
    FirstAbortedError: cjs.FirstAbortedError,
  },
]

for (const api of apis) {
  test(`${api.name}: CommonJS/ESM entrypoint exposes the expected API`, () => {
    assert.equal(typeof api.first, 'function')
    assert.equal(typeof api.firstAsync, 'function')
    assert.equal(typeof api.FirstAbortedError, 'function')

    if (api.name === 'CJS') {
      assert.equal(cjs.default, cjs)
      assert.equal(cjs.first, cjs)
    }
  })

  test(`${api.name}: first event wins and cleans all listeners`, () => {
    const a = new EventEmitter()
    const b = new EventEmitter()
    let result

    const waiter = api.first(
      [[a, 'close', 'error'], [b, 'finish']],
      (...args) => {
        result = args
      },
    )

    b.emit('finish', 1, 2)

    assert.deepEqual(result, [null, b, 'finish', [1, 2]])
    assert.equal(a.listenerCount('close'), 0)
    assert.equal(a.listenerCount('error'), 0)
    assert.equal(b.listenerCount('finish'), 0)

    waiter.cancel()
  })

  test(`${api.name}: callable waiter replaces callback`, () => {
    const ee = new EventEmitter()
    let result

    const waiter = api.first([[ee, 'ready']], () => {})
    waiter((...args) => {
      result = args
    })

    ee.emit('ready', 7)

    assert.deepEqual(result, [null, ee, 'ready', [7]])
  })

  test(`${api.name}: error without argument preserves undefined`, () => {
    const ee = new EventEmitter()
    let result

    api.first([[ee, 'error']], (...args) => {
      result = args
    })

    ee.emit('error')

    assert.equal(result[0], undefined)
  })

  test(`${api.name}: symbol events behave normally`, () => {
    const ee = new EventEmitter()
    const event = Symbol('ready')
    let result

    api.first([[ee, event]], (...args) => {
      result = args
    })

    ee.emit(event, 42)

    assert.deepEqual(result, [null, ee, event, [42]])
  })

  test(`${api.name}: cancel cleans listeners`, () => {
    const ee = new EventEmitter()
    let called = false

    const waiter = api.first([[ee, 'a', 'b']], () => {
      called = true
    })

    waiter.cancel()
    ee.emit('a')

    assert.equal(called, false)
    assert.equal(ee.listenerCount('a'), 0)
    assert.equal(ee.listenerCount('b'), 0)
  })

  test(`${api.name}: firstAsync resolves`, async () => {
    const ee = new EventEmitter()
    const promise = api.firstAsync([[ee, 'ready']])

    ee.emit('ready', 3)

    assert.deepEqual((await promise).args, [3])
  })

  test(`${api.name}: firstAsync rejects error by default`, async () => {
    const ee = new EventEmitter()
    const boom = new Error('boom')
    const promise = api.firstAsync([[ee, 'error']])

    ee.emit('error', boom)

    await assert.rejects(promise, error => error === boom)
  })

  test(`${api.name}: abort cleans listeners`, async () => {
    const ee = new EventEmitter()
    const controller = new AbortController()
    const promise = api.firstAsync([[ee, 'ready']], { signal: controller.signal })

    controller.abort('stop')

    await assert.rejects(
      promise,
      error => error instanceof api.FirstAbortedError && error.cause === 'stop',
    )
    assert.equal(ee.listenerCount('ready'), 0)
  })

  test(`${api.name}: already-aborted callback signal registers no listeners`, () => {
    let registrations = 0
    const emitter = {
      on() {
        registrations++
      },
      removeListener() {},
    }
    const controller = new AbortController()
    controller.abort()

    const waiter = api.first([[emitter, 'ready']], () => {}, { signal: controller.signal })
    waiter(() => {})
    waiter.cancel()

    assert.equal(registrations, 0)
  })

  test(`${api.name}: already-aborted Promise rejects before registration`, async () => {
    let registrations = 0
    const emitter = {
      on() {
        registrations++
      },
      removeListener() {},
    }
    const controller = new AbortController()
    controller.abort('already stopped')

    const promise = api.firstAsync([[emitter, 'ready']], { signal: controller.signal })

    await assert.rejects(
      promise,
      error => error instanceof api.FirstAbortedError && error.cause === 'already stopped',
    )
    assert.equal(registrations, 0)
  })

  test(`${api.name}: synchronous emitter completion cleans its listener`, () => {
    let removeAttempts = 0
    let result

    const emitter = {
      on(_event, listener) {
        listener('sync')
      },
      removeListener() {
        removeAttempts++
      },
    }

    api.first([[emitter, 'ready']], (...args) => {
      result = args
    })

    assert.deepEqual(result, [null, emitter, 'ready', ['sync']])
    assert.equal(removeAttempts, 1)
  })

  test(`${api.name}: registration failure rolls back prior listeners`, () => {
    const ee = new EventEmitter()
    const bad = {
      on() {
        throw new Error('bad')
      },
      removeListener() {},
    }

    assert.throws(
      () => api.first([[ee, 'a'], [bad, 'b']], () => {}),
      /bad/,
    )
    assert.equal(ee.listenerCount('a'), 0)
  })

  test(`${api.name}: registration and cleanup failures are combined`, () => {
    const listenerEmitter = {
      on() {},
      removeListener() {
        throw new Error('cleanup failed')
      },
    }
    const registrationError = new Error('registration failed')
    const failingEmitter = {
      on() {
        throw registrationError
      },
      removeListener() {},
    }

    assert.throws(
      () => api.first([[listenerEmitter, 'ready'], [failingEmitter, 'finish']], () => {}),
      error => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors[0], registrationError)
        assert.equal(error.errors[1].message, 'cleanup failed')
        return true
      },
    )
  })

  test(`${api.name}: firstAsync rejects when winning-event cleanup throws`, async () => {
    let listener
    const cleanupError = new Error('cleanup failed')
    const emitter = {
      on(_event, fn) {
        listener = fn
      },
      removeListener() {
        throw cleanupError
      },
    }

    const promise = api.firstAsync([[emitter, 'ready']])
    listener('value')

    await assert.rejects(promise, error => error === cleanupError)
  })

  test(`${api.name}: firstAsync combines event and cleanup failures`, async () => {
    let listener
    const eventError = new Error('event failed')
    const cleanupError = new Error('cleanup failed')
    const emitter = {
      on(_event, fn) {
        listener = fn
      },
      removeListener() {
        throw cleanupError
      },
    }

    const promise = api.firstAsync([[emitter, 'error']])
    listener(eventError)

    await assert.rejects(promise, error => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [eventError, cleanupError])
      return true
    })
  })

  test(`${api.name}: abort plus cleanup failure rejects with AggregateError`, async () => {
    const cleanupError = new Error('cleanup failed')
    const emitter = {
      on() {},
      removeListener() {
        throw cleanupError
      },
    }
    const controller = new AbortController()
    const promise = api.firstAsync([[emitter, 'ready']], { signal: controller.signal })

    controller.abort('cancelled')

    await assert.rejects(promise, error => {
      assert.ok(error instanceof AggregateError)
      assert.ok(error.errors[0] instanceof api.FirstAbortedError)
      assert.equal(error.errors[1], cleanupError)
      return true
    })
  })

  test(`${api.name}: cancel can retry cleanup that previously failed`, () => {
    let attempts = 0
    const emitter = {
      on() {},
      removeListener() {
        attempts++
        if (attempts === 1) throw new Error('temporary cleanup failure')
      },
    }

    const waiter = api.first([[emitter, 'ready']], () => {})

    assert.throws(() => waiter.cancel(), /temporary cleanup failure/)
    waiter.cancel()

    assert.equal(attempts, 2)
  })

  test(`${api.name}: callback still runs when cleanup fails, then cleanup can be retried`, () => {
    let listener
    let called = false
    let attempts = 0
    const cleanupError = new Error('cleanup failed')
    const emitter = {
      on(_event, fn) {
        listener = fn
      },
      removeListener() {
        attempts++
        throw cleanupError
      },
    }

    const waiter = api.first([[emitter, 'ready']], () => {
      called = true
    })

    assert.throws(() => listener('value'), error => error === cleanupError)
    assert.equal(called, true)
    assert.throws(() => waiter.cancel(), error => error === cleanupError)
    assert.equal(attempts, 2)
  })
}
