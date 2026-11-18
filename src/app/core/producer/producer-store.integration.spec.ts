import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from '../../app.config';
import { ProducerStore } from './producer-store';
import { provideStoreTestbed } from './testing/store-harness';
import type { StoreHarness } from './testing/store-harness';

/** Real app providers (routes + app initializer) with only the worker/seed/URL/clock faked. */
async function bootApp(): Promise<{ h: StoreHarness; router: RouterTestingHarness }> {
  const h = provideStoreTestbed();
  TestBed.configureTestingModule({ providers: appConfig.providers });
  const router = await RouterTestingHarness.create('/dashboard');
  h.worker().emit({ type: 'ready' });
  h.worker().emit({ type: 'status', runId: 1, status: 'running' });
  return { h, router };
}

describe('ProducerStore — navigation invariant (4.8)', () => {
  it('the app initializer boots exactly one worker before the first page', async () => {
    // Arrange
    const h = provideStoreTestbed();
    TestBed.configureTestingModule({ providers: appConfig.providers });

    // Act
    await RouterTestingHarness.create('/dashboard');

    // Assert
    expect(h.workers.workers).toHaveLength(1);
    expect(h.worker().sent.map((m) => m.type)).toEqual(['init', 'start']);
  });

  it('dashboard → settings → dashboard ×5 never creates another worker', async () => {
    // Arrange
    const { h, router } = await bootApp();

    // Act
    for (let i = 0; i < 5; i++) {
      await router.navigateByUrl('/settings');
      await router.navigateByUrl('/dashboard');
    }

    // Assert
    expect(h.workers.workers).toHaveLength(1);
    expect(h.worker().terminated).toBe(0);
    expect(TestBed.inject(ProducerStore).runId()).toBe(1);
  });

  it('pause survives navigation (still paused, no extra messages)', async () => {
    // Arrange
    const { h, router } = await bootApp();
    const store = TestBed.inject(ProducerStore);
    store.pause();
    const sent = h.worker().sent.length;

    // Act
    await router.navigateByUrl('/settings');
    await router.navigateByUrl('/dashboard');

    // Assert
    expect(store.status()).toBe('paused');
    expect(h.worker().sent).toHaveLength(sent);
  });
});
