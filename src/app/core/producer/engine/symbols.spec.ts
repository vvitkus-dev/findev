import { SETTINGS_LIMITS } from './producer-settings';
import { SYMBOLS } from './symbols';

describe('SYMBOLS', () => {
  it('has one ticker per allowed instrument', () => {
    // Act
    const count = SYMBOLS.length;

    // Assert
    expect(count).toBe(50);
    expect(count).toBe(SETTINGS_LIMITS.instrumentCount.max);
  });

  it('contains only unique tickers', () => {
    // Act
    const unique = new Set(SYMBOLS);

    // Assert
    expect(unique.size).toBe(SYMBOLS.length);
  });

  it('uses exactly four uppercase letters per ticker', () => {
    // Act
    const invalid = SYMBOLS.filter((s) => !/^[A-Z]{4}$/.test(s));

    // Assert
    expect(invalid).toEqual([]);
  });

  it('starts with ALFA, BETA', () => {
    // Act
    const first = SYMBOLS.slice(0, 2);

    // Assert
    expect(first).toEqual(['ALFA', 'BETA']);
  });

  it('is frozen so no caller can reorder tickers', () => {
    // Act
    const frozen = Object.isFrozen(SYMBOLS);

    // Assert
    expect(frozen).toBe(true);
  });
});
