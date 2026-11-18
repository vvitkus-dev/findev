import type { SettingsField } from '../../../core/producer/engine/producer-settings.model';

/** Static description of one settings input: its label, hint and element ids. */
export interface FieldView {
  readonly key: SettingsField;
  readonly label: string;
  readonly hint: string;
  readonly hintId: string;
  readonly errorId: string;
  /** `aria-describedby` while an error is shown: hint + error. */
  readonly describedByWithError: string;
}
