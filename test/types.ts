import type { EventEmitterLike, FirstCallback, FirstResult } from '../src/index.js'

const errorMayBeUndefined: FirstResult['error'] = undefined
void errorMayBeUndefined

const callback: FirstCallback = (error, emitter, event, args) => {
  if (error !== undefined && error !== null) {
    void error
  }

  void emitter
  void event
  void args
}

void callback

const emitterLike: EventEmitterLike = {
  on() {},
  removeListener() {},
}

void emitterLike
