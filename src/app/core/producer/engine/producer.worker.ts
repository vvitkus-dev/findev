/// <reference lib="webworker" />
import { ProducerEngine } from './producer-engine';
import type { ToWorker } from './protocol.model';
import { realClock, realScheduler } from './scheduler';
import { loadWasmGeneratorFactory } from './wasm-generator';

// Thin adapter: all behaviour lives in the (unit-tested) ProducerEngine.
const engine = new ProducerEngine({
  loadFactory: (wasmUrl) => loadWasmGeneratorFactory(new URL(wasmUrl)),
  scheduler: realScheduler,
  clock: realClock,
  post: (message) => {
    postMessage(message);
  },
});

addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  void engine.handle(message).then(() => {
    if (message.type === 'dispose') close();
  });
});
