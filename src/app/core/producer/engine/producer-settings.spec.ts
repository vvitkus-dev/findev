import type { ProducerSettings, SettingsField } from './producer-settings.model';
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  nominalRate,
  settingsFieldError,
  validateSettings,
} from './producer-settings';

const withField = (field: SettingsField, value: unknown): unknown => ({
  ...DEFAULT_SETTINGS,
  [field]: value,
});

describe('ProducerSettings', () => {
  it('defaults match the task specification', () => {
    // Act
    const result = validateSettings(DEFAULT_SETTINGS);

    // Assert
    expect(DEFAULT_SETTINGS).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
    expect(result.ok).toBe(true);
  });

  it('limits match the task specification', () => {
    // Act
    const limits = { ...SETTINGS_LIMITS };

    // Assert
    expect(limits).toEqual({
      instrumentCount: { min: 1, max: 50 },
      updatesPerBatch: { min: 1, max: 1000 },
      batchIntervalMs: { min: 50, max: 2000 },
    });
  });

  it.each<[SettingsField, number, boolean]>([
    ['instrumentCount', 0, false],
    ['instrumentCount', 1, true],
    ['instrumentCount', 50, true],
    ['instrumentCount', 51, false],
    ['updatesPerBatch', 0, false],
    ['updatesPerBatch', 1, true],
    ['updatesPerBatch', 1000, true],
    ['updatesPerBatch', 1001, false],
    ['batchIntervalMs', 49, false],
    ['batchIntervalMs', 50, true],
    ['batchIntervalMs', 2000, true],
    ['batchIntervalMs', 2001, false],
  ])('%s = %d → valid: %s', (field, value, valid) => {
    // Act
    const result = validateSettings(withField(field, value));

    // Assert
    expect(result.ok).toBe(valid);
  });

  it.each<[string, unknown]>([
    ['fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['numeric string', '5'],
    ['null', null],
    ['missing', undefined],
  ])('rejects a non-integer value: %s', (_label, value) => {
    // Act
    const result = validateSettings(withField('instrumentCount', value));

    // Assert
    expect(result).toEqual({
      ok: false,
      errors: [{ field: 'instrumentCount', message: 'Must be a whole number' }],
    });
  });

  it('reports every invalid field with its range message', () => {
    // Act
    const result = validateSettings({
      instrumentCount: 0,
      updatesPerBatch: 1001,
      batchIntervalMs: 10,
    });

    // Assert
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: 'instrumentCount', message: 'Must be between 1 and 50' },
        { field: 'updatesPerBatch', message: 'Must be between 1 and 1000' },
        { field: 'batchIntervalMs', message: 'Must be between 50 and 2000' },
      ],
    });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 42],
    ['an empty object', {}],
  ])('rejects %s as settings input', (_label, input) => {
    // Act
    const result = validateSettings(input);

    // Assert
    expect(result.ok).toBe(false);
  });

  it('returns only the known fields of a valid input', () => {
    // Arrange
    const input = { ...DEFAULT_SETTINGS, extra: 'ignored' };

    // Act
    const result = validateSettings(input);

    // Assert
    expect(result).toEqual({ ok: true, value: DEFAULT_SETTINGS });
  });

  it('settingsFieldError returns null for a valid value', () => {
    // Act
    const error = settingsFieldError('batchIntervalMs', 50);

    // Assert
    expect(error).toBeNull();
  });

  it('nominal rate of the defaults is 200 updates per second', () => {
    // Arrange
    const fast: ProducerSettings = {
      ...DEFAULT_SETTINGS,
      updatesPerBatch: 1000,
      batchIntervalMs: 50,
    };

    // Act
    const rates = [nominalRate(DEFAULT_SETTINGS), nominalRate(fast)];

    // Assert
    expect(rates).toEqual([200, 20_000]);
  });
});
