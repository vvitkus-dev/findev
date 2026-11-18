import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Pill } from './pill';
import type { PillTone } from './pill.model';

@Component({
  imports: [Pill],
  template: `<app-pill [tone]="tone()">Running</app-pill>`,
})
class Host {
  readonly tone = signal<PillTone>('positive');
}

describe('Pill', () => {
  let fixture: ComponentFixture<Host>;
  const pill = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('app-pill');

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
  });

  it('projects its label and exposes the tone as data-tone', async () => {
    // Arrange
    fixture.componentInstance.tone.set('positive');

    // Act
    await fixture.whenStable();

    // Assert
    expect(pill()?.textContent.trim()).toBe('Running');
    expect(pill()?.getAttribute('data-tone')).toBe('positive');
  });

  it('follows tone changes', async () => {
    // Arrange
    await fixture.whenStable();

    // Act
    fixture.componentInstance.tone.set('danger');
    await fixture.whenStable();

    // Assert
    expect(pill()?.getAttribute('data-tone')).toBe('danger');
  });

  it('defaults to the neutral tone', async () => {
    // Arrange
    const plain = TestBed.createComponent(Pill);

    // Act
    await plain.whenStable();

    // Assert
    expect((plain.nativeElement as HTMLElement).getAttribute('data-tone')).toBe('neutral');
  });
});
