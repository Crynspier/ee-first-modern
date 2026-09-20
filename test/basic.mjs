import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import first, { FirstAbortedError, firstAsync } from '../dist/index.js'

test('first event wins and cleans all listeners', () => {
  const a = new EventEmitter(); const b = new EventEmitter(); let result
  const waiter = first([[a,'close','error'],[b,'finish']], (...args) => { result=args })
  b.emit('finish', 1, 2)
  assert.deepEqual(result,[null,b,'finish',[1,2]])
  assert.equal(a.listenerCount('close'),0); assert.equal(a.listenerCount('error'),0); assert.equal(b.listenerCount('finish'),0)
  waiter.cancel()
})

test('callable waiter replaces callback', () => {
  const ee=new EventEmitter(); let result
  const waiter=first([[ee,'ready']],()=>{})
  waiter((...args)=>{result=args})
  ee.emit('ready',7)
  assert.deepEqual(result,[null,ee,'ready',[7]])
})

test('error without argument preserves undefined', () => {
  const ee=new EventEmitter(); let result
  first([[ee,'error']],(...args)=>{result=args})
  ee.emit('error')
  assert.equal(result[0],undefined)
})

test('cancel cleans listeners', () => {
  const ee=new EventEmitter(); let called=false
  const waiter=first([[ee,'a','b']],()=>{called=true})
  waiter.cancel(); ee.emit('a')
  assert.equal(called,false); assert.equal(ee.listenerCount('a'),0); assert.equal(ee.listenerCount('b'),0)
})

test('firstAsync resolves', async () => {
  const ee=new EventEmitter(); const p=firstAsync([[ee,'ready']]); ee.emit('ready',3)
  assert.deepEqual((await p).args,[3])
})

test('firstAsync rejects error by default', async () => {
  const ee=new EventEmitter(); const boom=new Error('boom'); const p=firstAsync([[ee,'error']]); ee.emit('error',boom)
  await assert.rejects(p,e=>e===boom)
})

test('abort cleans listeners', async () => {
  const ee=new EventEmitter(); const controller=new AbortController()
  const p=firstAsync([[ee,'ready']],{signal:controller.signal}); controller.abort('stop')
  await assert.rejects(p,e=>e instanceof FirstAbortedError)
  assert.equal(ee.listenerCount('ready'),0)
})

test('registration failure rolls back prior listeners', () => {
  const ee=new EventEmitter(); const bad={on(){throw new Error('bad')},removeListener(){}}
  assert.throws(()=>first([[ee,'a'],[bad,'b']],()=>{}),/bad/)
  assert.equal(ee.listenerCount('a'),0)
})

test('firstAsync rejects when winning-event cleanup throws', async () => {
  let listener
  const cleanupError = new Error('cleanup failed')
  const emitter = {
    on(_event, fn) { listener = fn },
    removeListener() { throw cleanupError },
  }

  const promise = firstAsync([[emitter, 'ready']])
  listener('value')

  await assert.rejects(promise, error => error === cleanupError)
})

test('firstAsync combines event and cleanup failures', async () => {
  let listener
  const eventError = new Error('event failed')
  const cleanupError = new Error('cleanup failed')
  const emitter = {
    on(_event, fn) { listener = fn },
    removeListener() { throw cleanupError },
  }

  const promise = firstAsync([[emitter, 'error']])
  listener(eventError)

  await assert.rejects(promise, error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [eventError, cleanupError])
    return true
  })
})

test('cancel can retry cleanup that previously failed', () => {
  let attempts = 0
  const emitter = {
    on() {},
    removeListener() {
      attempts++
      if (attempts === 1) throw new Error('temporary cleanup failure')
    },
  }

  const waiter = first([[emitter, 'ready']], () => {})
  assert.throws(() => waiter.cancel(), /temporary cleanup failure/)
  waiter.cancel()
  assert.equal(attempts, 2)
})

test('already-aborted callback signal registers no listeners', () => {
  let registrations = 0
  const emitter = {
    on() { registrations++ },
    removeListener() {},
  }
  const controller = new AbortController()
  controller.abort()

  const waiter = first([[emitter, 'ready']], () => {}, { signal: controller.signal })
  waiter(() => {})
  waiter.cancel()

  assert.equal(registrations, 0)
})

test('callback still runs when cleanup fails, then cleanup error is reported', () => {
  let listener
  let called = false
  const cleanupError = new Error('cleanup failed')
  const emitter = {
    on(_event, fn) { listener = fn },
    removeListener() { throw cleanupError },
  }

  const waiter = first([[emitter, 'ready']], () => { called = true })
  assert.throws(() => listener('value'), error => error === cleanupError)
  assert.equal(called, true)
  assert.throws(() => waiter.cancel(), error => error === cleanupError)
})
