import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import type { InstrumentMetrics } from '../../../core/producer/engine/metrics.model';
import { MetricsTable } from './metrics-table';

/** The plan's worked example: trades 10@100.00 and 30@102.00, book 101.96/102.00, 600/400. */
const WORKED: InstrumentMetrics = {
  symbol: 'ALFA',
  lastPriceCents: 10_200,
  spreadCents: 4,
  volume: 40,
  vwapCents: 10_150,
  imbalance: 0.2,
};
const EMPTY: InstrumentMetrics = {
  symbol: 'BETA',
  lastPriceCents: null,
  spreadCents: null,
  volume: 0,
  vwapCents: null,
  imbalance: null,
};

const cells = (fixture: ComponentFixture<MetricsTable>, row: number): string[] =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll(`tbody tr:nth-child(${row}) td`)].map(
    (td) => td.textContent.trim(),
  );

describe('MetricsTable', () => {
  let fixture: ComponentFixture<MetricsTable>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MetricsTable);
  });

  it('formats the worked example: $102.00, $0.04, 40, $101.50, +0.20', async () => {
    // Arrange
    fixture.componentRef.setInput('rows', [WORKED]);

    // Act
    await fixture.whenStable();

    // Assert
    expect(cells(fixture, 1)).toEqual(['$102.00', '$0.04', '40', '$101.50', '+0.20']);
  });

  it('shows — for unavailable metrics and 0 volume for an instrument without trades', async () => {
    // Arrange
    fixture.componentRef.setInput('rows', [EMPTY]);

    // Act
    await fixture.whenStable();

    // Assert
    expect(cells(fixture, 1)).toEqual(['—', '—', '0', '—', '—']);
  });

  it('renders one row per instrument, symbol as the row header', async () => {
    // Arrange
    fixture.componentRef.setInput('rows', [WORKED, EMPTY]);

    // Act
    await fixture.whenStable();

    // Assert
    const headers = [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody th')];
    expect(headers.map((th) => th.textContent.trim())).toEqual(['ALFA', 'BETA']);
    expect(headers.every((th) => th.getAttribute('scope') === 'row')).toBe(true);
  });

  it('marks imbalance direction with a class, while the sign stays in the text', async () => {
    // Arrange
    fixture.componentRef.setInput('rows', [
      WORKED,
      { ...EMPTY, symbol: 'GAMA', imbalance: -0.35 },
      EMPTY,
    ]);

    // Act
    await fixture.whenStable();

    // Assert
    const imbalanceCells = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody td:last-child'),
    ];
    expect(imbalanceCells.map((td) => [td.className.trim(), td.textContent.trim()])).toEqual([
      ['num bid-heavy', '+0.20'],
      ['num ask-heavy', '−0.35'],
      ['num', '—'],
    ]);
  });

  it('is an accessible table: caption and column headers with scope="col" (5.4)', async () => {
    // Arrange
    fixture.componentRef.setInput('rows', [WORKED]);

    // Act
    await fixture.whenStable();

    // Assert
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('table > caption')?.textContent.trim()).toContain('Live metrics');
    const cols = [...host.querySelectorAll('thead th')];
    expect(cols.map((th) => th.textContent.trim())).toEqual([
      'Symbol',
      'Last',
      'Spread',
      'Volume',
      'VWAP',
      'Imbalance',
    ]);
    expect(cols.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(host.querySelector('[aria-live]')).toBeNull();
  });

  it('the caption says so while repaints are limited, and only then', async () => {
    // Arrange
    fixture.componentRef.setInput('rows', [WORKED]);
    await fixture.whenStable();
    const caption = (): string | undefined =>
      (fixture.nativeElement as HTMLElement).querySelector('caption')?.textContent.trim();
    const normal = caption();

    // Act
    fixture.componentRef.setInput('repaintsLimited', true);
    await fixture.whenStable();

    // Assert
    expect(normal).toBe('Live metrics per instrument (prices in USD)');
    expect(caption()).toBe(
      'Live metrics per instrument (prices in USD) · refreshing 10×/s on this device',
    );
  });
});
