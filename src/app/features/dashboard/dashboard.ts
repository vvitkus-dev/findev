import { Component, inject } from '@angular/core';
import { ProducerStore } from '../../core/producer/producer-store';
import { MetricsTable } from './components/metrics-table';
import { ProducerStatus } from './components/producer-status';

/** Live market page: producer status + per-instrument metrics, both read from the store. */
@Component({
  selector: 'app-dashboard',
  imports: [MetricsTable, ProducerStatus],
  template: `
    <h2>Dashboard</h2>
    <app-producer-status />
    <app-metrics-table [rows]="rows()" />
  `,
  styles: `
    h2 {
      margin: 0 0 0.25rem;
      font-size: 1.125rem;
    }
  `,
})
export class Dashboard {
  protected readonly rows = inject(ProducerStore).rows;
}
