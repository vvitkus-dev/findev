import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormField, form, submit } from '@angular/forms/signals';
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  nominalRate,
} from '../../core/producer/engine/producer-settings';
import type { SettingsField } from '../../core/producer/engine/producer-settings.model';
import { ProducerStore } from '../../core/producer/producer-store';
import { VolumePipe } from '../../shared/format/market-format-pipes';
import { settingsSchema } from './settings-schema';

interface FieldView {
  readonly key: SettingsField;
  readonly label: string;
  readonly hint: string;
  readonly hintId: string;
  readonly errorId: string;
  /** `aria-describedby` while an error is shown: hint + error. */
  readonly describedByWithError: string;
}

const fieldView = (key: SettingsField, label: string, unit: string): FieldView => {
  const { min, max } = SETTINGS_LIMITS[key];
  return {
    key,
    label,
    hint: `${String(min)}–${String(max)} ${unit}`,
    hintId: `${key}-hint`,
    errorId: `${key}-error`,
    describedByWithError: `${key}-hint ${key}-error`,
  };
};

const FIELDS: readonly FieldView[] = [
  fieldView('instrumentCount', 'Instruments', 'instruments'),
  fieldView('updatesPerBatch', 'Updates per batch', 'updates'),
  fieldView('batchIntervalMs', 'Batch interval', 'ms'),
];

/**
 * Producer settings. The form edits a local draft (a `linkedSignal` copy of the applied
 * settings), so nothing reaches the producer until Apply, which starts a new run.
 */
@Component({
  selector: 'app-settings',
  imports: [FormField, VolumePipe],
  template: `
    <h2>Settings</h2>
    <p class="intro">
      Changes take effect only when you press Apply, which starts a new run and clears the
      dashboard.
    </p>
    <form novalidate (submit)="apply($event)">
      @for (f of fields; track f.key) {
        @let field = settingsForm[f.key];
        @let error = (field().touched() || field().dirty()) && field().errors()[0];
        <div class="field">
          <label [for]="f.key">{{ f.label }}</label>
          <input
            [id]="f.key"
            type="number"
            step="1"
            inputmode="numeric"
            [formField]="field"
            [attr.aria-invalid]="!!error"
            [attr.aria-describedby]="error ? f.describedByWithError : f.hintId"
          />
          <small [id]="f.hintId">{{ f.hint }}</small>
          @if (error) {
            <span class="error" [id]="f.errorId">{{ error.message }}</span>
          }
        </div>
      }
      <p class="rate">Nominal rate: {{ nominal() | volume }} updates/s</p>
      <div class="actions">
        <button type="submit" [disabled]="settingsForm().invalid()">Apply</button>
        <button type="button" (click)="resetToDefaults()">Reset to defaults</button>
      </div>
    </form>
    <p class="confirmation" role="status">{{ confirmation() }}</p>
  `,
  styles: `
    h2 {
      margin: 0 0 0.25rem;
      font-size: 1.125rem;
    }
    .intro {
      color: #555;
      margin-block: 0 1rem;
    }
    .field {
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
    .actions {
      display: flex;
      gap: 0.75rem;
    }
    button {
      min-height: 2.75rem;
      padding-inline: 1rem;
    }
    @media (max-width: 36rem) {
      .field {
        grid-template-columns: 1fr;
      }
      .error {
        grid-column: auto;
      }
    }
  `,
})
export class Settings {
  private readonly store = inject(ProducerStore);
  protected readonly fields = FIELDS;
  /** Local draft: re-syncs when the applied settings change, otherwise a private copy. */
  protected readonly draft = linkedSignal(() => ({ ...this.store.settings() }));
  protected readonly settingsForm = form(this.draft, settingsSchema);
  protected readonly nominal = computed(() =>
    this.settingsForm().valid() ? nominalRate(this.settingsForm().value()) : null,
  );
  protected readonly confirmation = signal('');

  protected async apply(event: Event): Promise<void> {
    event.preventDefault();
    // submit() marks every field touched and runs the action only when the form is valid.
    const applied = await submit(this.settingsForm, () => {
      this.store.apply(this.draft());
      return Promise.resolve();
    });
    if (!applied) return;
    const { instrumentCount, updatesPerBatch, batchIntervalMs } = this.store.settings();
    this.settingsForm().reset();
    this.confirmation.set(
      `Run #${String(this.store.runId())} started with ${String(instrumentCount)} instruments, ` +
        `${String(updatesPerBatch)} updates every ${String(batchIntervalMs)} ms.`,
    );
  }

  /** Fills the form with the defaults; nothing is applied until Apply. */
  protected resetToDefaults(): void {
    this.draft.set({ ...DEFAULT_SETTINGS });
    this.confirmation.set('');
  }
}
