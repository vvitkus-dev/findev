import { max, min, required, schema, validate } from '@angular/forms/signals';
import type { SchemaPath } from '@angular/forms/signals';
import { SETTINGS_LIMITS } from '../../core/producer/engine/producer-settings';
import type {
  ProducerSettings,
  SettingsField,
} from '../../core/producer/engine/producer-settings.model';

const FIELDS = Object.keys(SETTINGS_LIMITS) as readonly SettingsField[];

const rangeMessage = (field: SettingsField): string =>
  `Must be between ${String(SETTINGS_LIMITS[field].min)} and ${String(SETTINGS_LIMITS[field].max)}`;

/** required + range (from SETTINGS_LIMITS) + whole number, for one numeric field. */
function wholeNumberInRange(path: SchemaPath<number>, field: SettingsField): void {
  const { min: lo, max: hi } = SETTINGS_LIMITS[field];
  const message = rangeMessage(field);
  required(path, { message: 'Required' });
  min(path, lo, { message });
  max(path, hi, { message });
  // An empty number input yields NaN, so this also rejects a blank field.
  validate(path, ({ value }) =>
    Number.isInteger(value()) ? undefined : { kind: 'integer', message: 'Must be a whole number' },
  );
}

/**
 * Validation for the producer settings form. Limits come only from `SETTINGS_LIMITS` (shared
 * with the worker-side `validateSettings`), so the form and the engine can never disagree.
 */
export const settingsSchema = schema<ProducerSettings>((path) => {
  for (const field of FIELDS) wholeNumberInRange(path[field], field);
});
