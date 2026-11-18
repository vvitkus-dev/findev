import { Component, computed, inject } from '@angular/core';
import { nominalRate } from '../../../core/producer/engine/producer-settings';
import { STATUS_VIEW } from '../../../core/producer/producer-status-view';
import { ProducerStore } from '../../../core/producer/producer-store';
import { VolumePipe } from '../../../shared/format/market-format-pipes';
import { Pill } from '../../../shared/ui/pill';

/**
 * Producer status bar: state pill, Pause/Resume, run, settings, nominal vs measured throughput.
 * Only the state text is an aria-live region (changes rarely); the fast-changing numbers are
 * not announced. Errors are shown by the app-wide banner in the shell.
 */
@Component({
  selector: 'app-producer-status',
  imports: [Pill, VolumePipe],
  template: `
    @let status = store.status();
    <section class="bar" aria-label="Producer">
      <app-pill [tone]="tone()" role="status" aria-live="polite">
        @switch (status) {
          @case ('initializing') {
            Initializing
          }
          @case ('running') {
            Running
          }
          @case ('paused') {
            Paused
          }
          @case ('error') {
            Error
          }
          @default never;
        }
      </app-pill>
      <!-- Before the counters, so growing numbers never shift the control. -->
      <button
        type="button"
        [disabled]="!controllable()"
        [attr.aria-pressed]="status === 'paused'"
        (click)="toggle()"
      >
        {{ status === 'paused' ? 'Resume' : 'Pause' }}
      </button>
      <span>Run #{{ store.runId() }}</span>
      <span>
        {{ store.settings().instrumentCount }} instruments ·
        {{ store.settings().updatesPerBatch }} updates every
        {{ store.settings().batchIntervalMs }} ms
      </span>
      <span class="num">
        {{ nominal() | volume }}/s nominal · {{ store.stats().updatesPerSec | volume }}/s measured
      </span>
      <span class="num">{{ store.stats().batches | volume }} batches</span>
    </section>
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      padding-block: 0.5rem;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    button {
      min-height: 2.75rem;
      min-width: 5.5rem;
    }
  `,
})
export class ProducerStatus {
  protected readonly store = inject(ProducerStore);
  protected readonly tone = computed(() => STATUS_VIEW[this.store.status()].tone);
  protected readonly nominal = computed(() => nominalRate(this.store.settings()));
  /** Pause/Resume only make sense once the worker has acknowledged the run. */
  protected readonly controllable = computed(() => {
    const status = this.store.status();
    return status === 'running' || status === 'paused';
  });

  protected toggle(): void {
    if (this.store.status() === 'paused') this.store.resume();
    else this.store.pause();
  }
}
