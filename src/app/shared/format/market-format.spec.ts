import { EMPTY, formatCents, formatImbalance, formatVolume } from './market-format';

describe('market-format', () => {
  it.each<[number | null, string]>([
    [10_150, '$101.50'],
    [4, '$0.04'],
    [0, '$0.00'],
    [123_456_789, '$1,234,567.89'],
    [10_150.5, '$101.51'],
    [10_150.49, '$101.50'],
    [null, '—'],
    [Number.NaN, '—'],
  ])('formatCents(%s) → %s', (cents, expected) => {
    // Act
    const text = formatCents(cents);

    // Assert
    expect(text).toBe(expected);
  });

  it.each<[number | null, string]>([
    [0.2, '+0.20'],
    [-0.35, '−0.35'],
    [-1, '−1.00'],
    [1, '+1.00'],
    [0, '0.00'],
    [-0, '0.00'],
    [-0.001, '0.00'],
    [0.004, '0.00'],
    [1.7, '+1.00'],
    [-3, '−1.00'],
    [null, '—'],
    [Number.NaN, '—'],
  ])('formatImbalance(%s) → %s', (value, expected) => {
    // Act
    const text = formatImbalance(value);

    // Assert
    expect(text).toBe(expected);
  });

  it.each<[number | null, string]>([
    [0, '0'],
    [999, '999'],
    [1_234_567, '1,234,567'],
    [1_234.6, '1,235'],
    [null, '—'],
    [Number.POSITIVE_INFINITY, '—'],
  ])('formatVolume(%s) → %s', (volume, expected) => {
    // Act
    const text = formatVolume(volume);

    // Assert
    expect(text).toBe(expected);
  });

  it('uses the em dash as the shared empty placeholder', () => {
    // Act
    const placeholders = [formatCents(null), formatImbalance(null), formatVolume(null)];

    // Assert
    expect(placeholders).toEqual([EMPTY, EMPTY, EMPTY]);
    expect(EMPTY).toBe('—');
  });
});
