import type { FromWorker, ToWorker } from '../engine/protocol.model';
import type { WorkerFactory, WorkerPort } from '../producer-tokens.model';

/** In-memory `WorkerPort`: records what the store sends and lets the test play the worker. */
export class FakeWorker implements WorkerPort {
  readonly sent: ToWorker[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated++;
  }

  /** Delivers a worker → main message synchronously. */
  emit(message: FromWorker): void {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }

  /** Simulates an uncaught error inside the worker. */
  crash(message: string): void {
    this.onerror?.(new ErrorEvent('error', { message }));
  }

  /** Simulates a message that could not be deserialized. */
  garble(): void {
    this.onmessageerror?.(new MessageEvent('messageerror'));
  }

  get last(): ToWorker | undefined {
    return this.sent.at(-1);
  }
}

/** Factory that hands out a new `FakeWorker` per call and remembers them all. */
export class FakeWorkerFactory {
  readonly workers: FakeWorker[] = [];
  readonly create: WorkerFactory = () => {
    const worker = new FakeWorker();
    this.workers.push(worker);
    return worker;
  };

  /** The most recently created worker (throws if none, so tests fail loudly). */
  get current(): FakeWorker {
    const worker = this.workers.at(-1);
    if (worker === undefined) throw new Error('no worker created yet');
    return worker;
  }
}
