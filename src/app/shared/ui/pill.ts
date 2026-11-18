import { Component, input } from '@angular/core';
import type { PillTone } from './pill.model';

/** Rounded status label: `<app-pill tone="positive">Running</app-pill>`. */
@Component({
  selector: 'app-pill',
  template: `<ng-content />`,
  host: { '[attr.data-tone]': 'tone()' },
  styles: `
    :host {
      display: inline-block;
      padding: 0.125rem 0.625rem;
      border-radius: 999px;
      font-weight: 600;
      white-space: nowrap;
      background: #e8e8e8;
      color: #333;
    }
    :host([data-tone='positive']) {
      background: #d7f0dc;
      color: #146c2e;
    }
    :host([data-tone='warning']) {
      background: #fff1c2;
      color: #6b4f00;
    }
    :host([data-tone='danger']) {
      background: #fbd9d6;
      color: #b3261e;
    }
  `,
})
export class Pill {
  readonly tone = input<PillTone>('neutral');
}
