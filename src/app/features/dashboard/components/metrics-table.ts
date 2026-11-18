import { Component, input } from '@angular/core';
import type { InstrumentMetrics } from '../../../core/producer/engine/metrics.model';
import { CentsPipe, ImbalancePipe, VolumePipe } from '../../../shared/format/market-format-pipes';

/**
 * Live per-instrument metrics. Purely presentational: rows in, formatted cells out (pure pipes,
 * no method calls). Deliberately NOT an aria-live region: at up to 20 updates/s it would flood
 * screen readers; the producer status line announces state changes instead.
 */
@Component({
  selector: 'app-metrics-table',
  imports: [CentsPipe, ImbalancePipe, VolumePipe],
  template: `
    <div class="scroll">
      <table>
        <caption>
          Live metrics per instrument (prices in USD)
        </caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col" class="num">Last</th>
            <th scope="col" class="num">Spread</th>
            <th scope="col" class="num">Volume</th>
            <th scope="col" class="num">VWAP</th>
            <th scope="col" class="num">Imbalance</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.symbol) {
            <tr>
              <th scope="row">{{ r.symbol }}</th>
              <td class="num">{{ r.lastPriceCents | cents }}</td>
              <td class="num">{{ r.spreadCents | cents }}</td>
              <td class="num">{{ r.volume | volume }}</td>
              <td class="num">{{ r.vwapCents | cents }}</td>
              <td
                class="num"
                [class.bid-heavy]="r.imbalance !== null && r.imbalance > 0"
                [class.ask-heavy]="r.imbalance !== null && r.imbalance < 0"
              >
                {{ r.imbalance | imbalance }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .scroll {
      overflow-x: auto;
    }
    /* Fixed layout: column widths never depend on the (changing) numbers, so nothing moves when
       data arrives. */
    table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
      min-width: 36rem;
    }
    caption {
      text-align: start;
      padding-block: 0.5rem;
      color: #555;
    }
    th,
    td {
      padding: 0.375rem 0.75rem;
      border-bottom: 1px solid #e5e5e5;
      text-align: start;
      white-space: nowrap;
    }
    .num {
      text-align: end;
      font-variant-numeric: tabular-nums;
    }
    tbody th {
      font-weight: 600;
    }
    .bid-heavy {
      color: #146c2e;
    }
    .ask-heavy {
      color: #b3261e;
    }
  `,
})
export class MetricsTable {
  readonly rows = input.required<readonly InstrumentMetrics[]>();
}
