import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import type { FieldTree } from '@angular/forms/signals';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '../../core/producer/engine/producer-settings';
import type {
  ProducerSettings,
  SettingsField,
} from '../../core/producer/engine/producer-settings.model';
import { settingsSchema } from './settings-schema';

/** A form over `settings` (no DOM): `form()` only needs an injection context. */
const settingsForm = (settings: Partial<ProducerSettings> = {}): FieldTree<ProducerSettings> =>
  form(signal({ ...DEFAULT_SETTINGS, ...settings }), settingsSchema, {
    injector: TestBed.inject(Injector),
  });

describe('settingsSchema', () => {
  it('accepts the defaults', () => {
    // Arrange
    const model = { ...DEFAULT_SETTINGS };

    // Act
    const f = settingsForm(model);

    // Assert
    expect(f().valid()).toBe(true);
  });

  it('instrumentCount = 0 ⇒ a min error with the range message', () => {
    // Arrange
    const model = { instrumentCount: 0 };

    // Act
    const f = settingsForm(model);

    // Assert
    const [first] = f.instrumentCount().errors();
    expect(first?.kind).toBe('min');
    expect(first?.message).toBe('Must be between 1 and 50');
  });

  it('above the limit ⇒ a max error with the same range message', () => {
    // Arrange
    const model = { batchIntervalMs: 2_001 };

    // Act
    const f = settingsForm(model);

    // Assert
    expect(f.batchIntervalMs().getError('max')?.message).toBe('Must be between 50 and 2000');
  });

  it('instrumentCount = 1.5 ⇒ an integer error', () => {
    // Arrange
    const model = { instrumentCount: 1.5 };

    // Act
    const f = settingsForm(model);

    // Assert
    expect(f.instrumentCount().getError('integer')?.message).toBe('Must be a whole number');
  });

  it('NaN (an empty number input) ⇒ invalid', () => {
    // Arrange
    const model = { updatesPerBatch: Number.NaN };

    // Act
    const f = settingsForm(model);

    // Assert
    expect(f.updatesPerBatch().invalid()).toBe(true);
    expect(f().invalid()).toBe(true);
  });

  it.each(Object.entries(SETTINGS_LIMITS) as [SettingsField, { min: number; max: number }][])(
    '%s: both boundaries are valid, one step outside is not',
    (field, { min, max }) => {
      // Arrange
      const values = [min, max, min - 1, max + 1];

      // Act
      const valid = values.map((v) => {
        const f = settingsForm({ [field]: v });
        return f[field]().valid();
      });

      // Assert
      expect(valid).toEqual([true, true, false, false]);
    },
  );
});
