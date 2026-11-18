import type { PillTone } from '../../shared/ui/pill.model';
import type { ProducerStatus } from './producer-store.model';

interface StatusView {
  readonly label: string;
  readonly tone: PillTone;
}

/** Label + pill tone per producer status. A `Record`, so a new status fails to compile here. */
export const STATUS_VIEW: Readonly<Record<ProducerStatus, StatusView>> = {
  initializing: { label: 'Initializing', tone: 'neutral' },
  running: { label: 'Running', tone: 'positive' },
  paused: { label: 'Paused', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};
