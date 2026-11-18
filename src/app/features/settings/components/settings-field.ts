import { Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import type { FieldView } from './settings-field.model';

/**
 * One labelled number input of the Settings form, with its hint and validation error.
 *
 * A component rather than an `@for` row on purpose: Angular builds a child component's
 * elements in the parent's creation pass, while `@for` rows only appear in the first update
 * pass. On a slow device a frame can be painted between the two, and the rows then push the
 * buttons down (a layout shift).
 */
@Component({
  selector: 'app-settings-field',
  imports: [FormField],
  host: { class: 'field' },
  template: `
    <label [for]="view().key">{{ view().label }}</label>
    <input
      [id]="view().key"
      type="number"
      step="1"
      inputmode="numeric"
      [formField]="field()"
      [attr.aria-invalid]="!!error()"
      [attr.aria-describedby]="error() ? view().describedByWithError : view().hintId"
    />
    <small [id]="view().hintId">{{ view().hint }}</small>
    @if (error(); as e) {
      <span class="error" [id]="view().errorId">{{ e.message }}</span>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: 10rem 8rem auto;
      align-items: center;
      gap: 0.25rem 0.75rem;
      margin-block-end: 0.75rem;
    }
    input {
      min-height: 2.75rem;
      padding-inline: 0.5rem;
      font: inherit;
      font-variant-numeric: tabular-nums;
    }
    input[aria-invalid='true'] {
      border-color: #b3261e;
    }
    small {
      color: #555;
    }
    .error {
      grid-column: 2 / -1;
      color: #b3261e;
    }
    @media (max-width: 36rem) {
      :host {
        grid-template-columns: 1fr;
      }
      .error {
        grid-column: auto;
      }
    }
  `,
})
export class SettingsField {
  readonly view = input.required<FieldView>();
  readonly field = input.required<FieldTree<number>>();

  /** The first error, shown once the user has touched or changed the field. */
  protected readonly error = computed(() => {
    const state = this.field()();
    return (state.touched() || state.dirty()) && state.errors()[0];
  });
}
