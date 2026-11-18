import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ProducerStoreStub, provideStoreStub } from '../../../core/producer/testing/store-stub';
import { ProducerStatus } from './producer-status';

describe('ProducerStatus', () => {
  let stub: ProducerStoreStub;
  let fixture: ComponentFixture<ProducerStatus>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (): HTMLButtonElement => {
    const el = host().querySelector<HTMLButtonElement>('.bar button');
    if (el === null) throw new Error('Pause/Resume button missing');
    return el;
  };

  beforeEach(() => {
    stub = new ProducerStoreStub();
    TestBed.configureTestingModule({ providers: [provideStoreStub(stub)] });
    fixture = TestBed.createComponent(ProducerStatus);
  });

  it('running: shows Running and a Pause button that calls store.pause()', async () => {
    // Arrange
    await fixture.whenStable();

    // Act
    button().click();
    await fixture.whenStable();

    // Assert
    expect(host().querySelector('[role="status"]')?.textContent.trim()).toBe('Running');
    expect(button().textContent.trim()).toBe('Pause');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(stub.calls).toEqual(['pause']);
  });

  it('paused: the button reads Resume, is pressed, and calls store.resume()', async () => {
    // Arrange
    stub.status.set('paused');
    await fixture.whenStable();

    // Act
    button().click();
    await fixture.whenStable();

    // Assert
    expect(button().textContent.trim()).toBe('Resume');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(stub.calls).toEqual(['resume']);
  });

  it.each(['initializing', 'error'] as const)('%s: the button is disabled', async (status) => {
    // Arrange
    stub.status.set(status);

    // Act
    await fixture.whenStable();

    // Assert
    expect(button().disabled).toBe(true);
  });

  it('error: an alert with the message and a Retry button that calls store.retry()', async () => {
    // Arrange
    stub.status.set('error');
    stub.error.set('Could not load the market producer (HTTP 404).');
    await fixture.whenStable();
    const alert = host().querySelector('[role="alert"]');

    // Act
    alert?.querySelector('button')?.click();
    await fixture.whenStable();

    // Assert
    expect(alert?.textContent).toContain('Could not load the market producer (HTTP 404).');
    expect(alert?.querySelector('button')?.textContent.trim()).toBe('Retry');
    expect(stub.calls).toEqual(['retry']);
  });

  it('no alert while there is no error', async () => {
    // Arrange
    stub.status.set('running');

    // Act
    await fixture.whenStable();

    // Assert
    expect(host().querySelector('[role="alert"]')).toBeNull();
  });

  it('shows run, settings, nominal vs measured throughput and batches', async () => {
    // Arrange
    stub.runId.set(3);
    stub.settings.set({ instrumentCount: 50, updatesPerBatch: 1_000, batchIntervalMs: 50 });
    stub.stats.set({ updatesPerSec: 19_840, batches: 1_234, updates: 1_234_000 });

    // Act
    await fixture.whenStable();

    // Assert
    const text = host().querySelector('.bar')?.textContent.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Run #3');
    expect(text).toContain('50 instruments · 1000 updates every 50 ms');
    expect(text).toContain('20,000/s nominal · 19,840/s measured');
    expect(text).toContain('1,234 batches');
  });

  it('announces only the state text: one polite status region (5.4)', async () => {
    // Arrange
    stub.status.set('paused');

    // Act
    await fixture.whenStable();

    // Assert
    const live = host().querySelectorAll('[aria-live]');
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute('role')).toBe('status');
    expect(live[0]?.getAttribute('aria-live')).toBe('polite');
    expect(live[0]?.textContent.trim()).toBe('Paused');
  });
});
