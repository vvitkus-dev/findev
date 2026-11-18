import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CentsPipe, ImbalancePipe, VolumePipe } from './market-format-pipes';

@Component({
  imports: [CentsPipe, ImbalancePipe, VolumePipe],
  template: `<span class="price">{{ price() | cents }}</span>
    <span class="imbalance">{{ imbalance() | imbalance }}</span>
    <span class="volume">{{ volume() | volume }}</span>`,
})
class Host {
  readonly price = signal<number | null>(10_150);
  readonly imbalance = signal<number | null>(-0.35);
  readonly volume = signal<number | null>(1_234_567);
}

const text = (root: HTMLElement, selector: string): string | undefined =>
  root.querySelector(selector)?.textContent.trim();

describe('market format pipes', () => {
  it('each pipe delegates to its format function', () => {
    // Act
    const out = [
      new CentsPipe().transform(10_150),
      new ImbalancePipe().transform(0.2),
      new VolumePipe().transform(null),
    ];

    // Assert
    expect(out).toEqual(['$101.50', '+0.20', '—']);
  });

  it('render in a template and update when the signals change', async () => {
    // Arrange
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.componentInstance.price.set(null);
    fixture.componentInstance.volume.set(0);

    // Act
    await fixture.whenStable();

    // Assert
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root, '.price')).toBe('—');
    expect(text(root, '.imbalance')).toBe('−0.35');
    expect(text(root, '.volume')).toBe('0');
  });
});
