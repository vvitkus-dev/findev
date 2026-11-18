import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ProducerStoreStub, provideStoreStub } from '../../core/producer/testing/store-stub';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let stub: ProducerStoreStub;
  let fixture: ComponentFixture<Dashboard>;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    stub = new ProducerStoreStub();
    TestBed.configureTestingModule({ providers: [provideStoreStub(stub)] });
    fixture = TestBed.createComponent(Dashboard);
  });

  it.each([1, 5, 50])('renders %i rows for %i instruments', async (count) => {
    // Arrange
    stub.instrumentCount.set(count);

    // Act
    await fixture.whenStable();

    // Assert
    expect(host().querySelectorAll('app-metrics-table tbody tr')).toHaveLength(count);
  });

  it('re-renders when the store rows change (new run with a different count)', async () => {
    // Arrange
    await fixture.whenStable();

    // Act
    stub.instrumentCount.set(8);
    await fixture.whenStable();

    // Assert
    expect(host().querySelectorAll('tbody tr')).toHaveLength(8);
  });

  it('composes the producer status bar above the table', async () => {
    // Arrange
    stub.status.set('paused');

    // Act
    await fixture.whenStable();

    // Assert
    const status = host().querySelector('app-producer-status');
    expect(status?.querySelector('[role="status"]')?.textContent.trim()).toBe('Paused');
    expect(status?.compareDocumentPosition(host().querySelector('app-metrics-table') as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
