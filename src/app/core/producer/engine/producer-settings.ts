import type {
  ProducerSettings,
  SettingsError,
  SettingsField,
  SettingsLimit,
  SettingsValidation,
} from './producer-settings.model';

/** Defaults required by the task: 5 instruments, 100 updates every 500 ms. */
export const DEFAULT_SETTINGS: ProducerSettings = Object.freeze({
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
});

/**
 * The single source of truth for settings ranges (the Settings form schema reads these).
 * `instrumentCount` and `updatesPerBatch` mirror `MAX_INSTRUMENTS` / `MAX_BATCH` in the Rust ABI.
 */
export const SETTINGS_LIMITS: Readonly<Record<SettingsField, SettingsLimit>> = Object.freeze({
  instrumentCount: { min: 1, max: 50 },
  updatesPerBatch: { min: 1, max: 1000 },
  batchIntervalMs: { min: 50, max: 2000 },
});

const FIELDS = Object.keys(SETTINGS_LIMITS) as readonly SettingsField[];

/** Error message for one field value, or `null` when it is a valid integer within its limit. */
export function settingsFieldError(field: SettingsField, value: unknown): string | null {
  const { min, max } = SETTINGS_LIMITS[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return 'Must be a whole number';
  }
  return value < min || value > max ? `Must be between ${String(min)} and ${String(max)}` : null;
}

/** Validates untrusted input (e.g. a worker message) into `ProducerSettings`. */
export function validateSettings(input: unknown): SettingsValidation {
  const record: Partial<Record<SettingsField, unknown>> =
    typeof input === 'object' && input !== null ? input : {};
  const errors: SettingsError[] = [];
  for (const field of FIELDS) {
    const message = settingsFieldError(field, record[field]);
    if (message !== null) errors.push({ field, message });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      instrumentCount: record.instrumentCount as number,
      updatesPerBatch: record.updatesPerBatch as number,
      batchIntervalMs: record.batchIntervalMs as number,
    },
  };
}

/** Updates per second the settings ask for (the producer may fall behind it under load). */
export function nominalRate(settings: ProducerSettings): number {
  return (settings.updatesPerBatch * 1000) / settings.batchIntervalMs;
}
