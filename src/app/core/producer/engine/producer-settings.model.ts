/** Producer configuration chosen on the Settings page. All fields are integers. */
export interface ProducerSettings {
  /** Number of simulated instruments (rows on the dashboard). */
  readonly instrumentCount: number;
  /** Market updates generated per batch. */
  readonly updatesPerBatch: number;
  /** Target delay between batch starts, in milliseconds. */
  readonly batchIntervalMs: number;
}

export type SettingsField = keyof ProducerSettings;

/** Inclusive integer range for one settings field. */
export interface SettingsLimit {
  readonly min: number;
  readonly max: number;
}

export interface SettingsError {
  readonly field: SettingsField;
  readonly message: string;
}

export type SettingsValidation =
  | { readonly ok: true; readonly value: ProducerSettings }
  | { readonly ok: false; readonly errors: readonly SettingsError[] };
