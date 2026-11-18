import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { provideStoreTestbed, snapshot } from './core/producer/testing/store-harness';
import type { StoreHarness } from './core/producer/testing/store-harness';

/**
 * Settings → Dashboard through the real router, store and pages; only the worker is fake (6.5).
 */
describe('apply from Settings resets the Dashboard (6.5)', () => {
  let h: StoreHarness;
  let router: RouterTestingHarness;
  const volumes = (): string[] =>
    [...(router.routeNativeElement?.querySelectorAll('tbody tr td:nth-child(4)') ?? [])].map((td) =>
      td.textContent.trim(),
    );

  /** Types into a Settings field and clicks Apply. */
  async function applyFromSettings(instrumentCount: string): Promise<void> {
    await router.navigateByUrl('/settings');
    const page = router.routeNativeElement;
    const input = page?.querySelector<HTMLInputElement>('#instrumentCount');
    if (!input) throw new Error('settings form missing');
    input.value = instrumentCount;
    input.dispatchEvent(new Event('input'));
    await router.fixture.whenStable();
    page?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await router.fixture.whenStable();
    await router.navigateByUrl('/dashboard');
  }

  beforeEach(async () => {
    h = provideStoreTestbed();
    TestBed.configureTestingModule({ providers: appConfig.providers });
    router = await RouterTestingHarness.create('/dashboard');
    h.worker().emit({ type: 'ready' });
    h.worker().emit({ type: 'status', runId: 1, status: 'running' });
    h.worker().emit(snapshot(1, 0));
    await router.fixture.whenStable();
  });

  it('clears the rows on apply, rejects late run-1 snapshots, accepts run 2', async () => {
    // Arrange
    const before = volumes();
    await applyFromSettings('3');
    const afterApply = volumes();
    h.worker().emit(snapshot(1, 1));
    await router.fixture.whenStable();
    const afterStale = volumes();

    // Act
    h.worker().emit(snapshot(2, 0, { count: 3 }));
    await router.fixture.whenStable();

    // Assert
    expect(before).toEqual(['10', '10', '10', '10', '10']);
    expect(afterApply).toEqual(['0', '0', '0']);
    expect(afterStale).toEqual(['0', '0', '0']);
    expect(volumes()).toEqual(['10', '10', '10']);
    expect(h.worker().last).toMatchObject({ type: 'start', runId: 2 });
    expect(h.workers.workers).toHaveLength(1);
  });
});
