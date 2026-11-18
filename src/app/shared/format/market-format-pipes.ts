import { Pipe, type PipeTransform } from '@angular/core';
import { formatCents, formatImbalance, formatVolume } from './market-format';

/** `{{ row.vwapCents | cents }}` → `$101.50`. Pure: delegates to `formatCents`. */
@Pipe({ name: 'cents' })
export class CentsPipe implements PipeTransform {
  transform(cents: number | null): string {
    return formatCents(cents);
  }
}

/** `{{ row.imbalance | imbalance }}` → `+0.20`. Pure: delegates to `formatImbalance`. */
@Pipe({ name: 'imbalance' })
export class ImbalancePipe implements PipeTransform {
  transform(value: number | null): string {
    return formatImbalance(value);
  }
}

/** `{{ row.volume | volume }}` → `1,234,567`. Pure: delegates to `formatVolume`. */
@Pipe({ name: 'volume' })
export class VolumePipe implements PipeTransform {
  transform(volume: number | null): string {
    return formatVolume(volume);
  }
}
