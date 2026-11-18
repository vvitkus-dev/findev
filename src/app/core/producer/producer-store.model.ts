export type ProducerStatus = 'initializing' | 'running' | 'paused' | 'error';

export interface ProducerStats {
  /** Measured over the last second (not the nominal rate from the settings). */
  readonly updatesPerSec: number;
  /** Batches received in the current run. */
  readonly batches: number;
  /** Updates received in the current run. */
  readonly updates: number;
}
