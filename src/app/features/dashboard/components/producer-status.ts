import { Component, computed, inject } from '@angular/core';
import { nominalRate } from '../../../core/producer/engine/producer-settings';
import { ProducerStore } from '../../../core/producer/producer-store';
import { VolumePipe } from '../../../shared/format/market-format-pipes';

/**
 * Producer status bar: state pill, run, settings, nominal vs measured throughput, and the
 * Pause/Resume control. Only the state text is an aria-live region (changes rarely); the
 * fast-changing numbers are not announced.
 */
@Component({
  selector: 'app-producer-status',
  imports: [VolumePipe],
  template: `
    @let status = store.status();
    <section class="bar" aria-label="Producer">
      <span class="pill" [attr.data-status]="status" role="status" aria-live="polite">
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
      </span>
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
      <button
        type="button"
        [disabled]="!controllable()"
        [attr.aria-pressed]="status === 'paused'"
        (click)="toggle()"
      >
        {{ status === 'paused' ? 'Resume' : 'Pause' }}
      </button>
    </section>
    @if (store.error(); as message) {
      <div class="error" role="alert">
        <span>{{ message }}</span>
        <button type="button" (click)="store.retry()">Retry</button>
      </div>
    }
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      padding-block: 0.5rem;
    }
    .pill {
      padding: 0.125rem 0.625rem;
      border-radius: 999px;
      font-weight: 600;
      background: #e8e8e8;
    }
    .pill[data-status='running'] {
      background: #d7f0dc;
      color: #146c2e;
    }
    .pill[data-status='paused'] {
      background: #fff1c2;
      color: #6b4f00;
    }
    .pill[data-status='error'] {
      background: #fbd9d6;
      color: #b3261e;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    button {
      min-height: 2.75rem;
      min-width: 5.5rem;
    }
    .error {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid #b3261e;
      border-radius: 0.375rem;
      color: #b3261e;
    }
  `,
})
export class ProducerStatus {
  protected readonly store = inject(ProducerStore);
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
