import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { form, submit } from '@angular/forms/signals';
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  nominalRate,
} from '../../core/producer/engine/producer-settings';
import type { SettingsField as SettingsKey } from '../../core/producer/engine/producer-settings.model';
import { ProducerStore } from '../../core/producer/producer-store';
import { VolumePipe } from '../../shared/format/market-format-pipes';
import { SettingsField } from './components/settings-field';
import type { FieldView } from './components/settings-field.model';
import { settingsSchema } from './settings-schema';

const fieldView = (key: SettingsKey, label: string, unit: string): FieldView => {
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

const FIELDS: Readonly<Record<SettingsKey, FieldView>> = {
  instrumentCount: fieldView('instrumentCount', 'Instruments', 'instruments'),
  updatesPerBatch: fieldView('updatesPerBatch', 'Updates per batch', 'updates'),
  batchIntervalMs: fieldView('batchIntervalMs', 'Batch interval', 'ms'),
};

/**
 * Producer settings. The form edits a local draft (a `linkedSignal` copy of the applied
 * settings), so nothing reaches the producer until Apply, which starts a new run.
 */
@Component({
  selector: 'app-settings',
  imports: [SettingsField, VolumePipe],
  template: `
    <h2>Settings</h2>
    <p class="intro">
      Changes take effect only when you press Apply, which starts a new run and clears the
      dashboard.
    </p>
    <form novalidate (submit)="apply($event)">
      <!-- Static rows (not @for), so they exist from the first frame: see SettingsField. -->
      <app-settings-field [view]="fields.instrumentCount" [field]="settingsForm.instrumentCount" />
      <app-settings-field [view]="fields.updatesPerBatch" [field]="settingsForm.updatesPerBatch" />
      <app-settings-field [view]="fields.batchIntervalMs" [field]="settingsForm.batchIntervalMs" />
      <p class="rate">
        Nominal rate: <span>{{ nominal() | volume }}</span> updates/s
      </p>
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
    .actions {
      display: flex;
      gap: 0.75rem;
    }
    button {
      min-height: 2.75rem;
      padding-inline: 1rem;
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
