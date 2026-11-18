import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { BUILD_VERSION } from './core/build-info';
import { ProducerStoreStub, provideStoreStub } from './core/producer/testing/store-stub';

describe('App shell', () => {
  let stub: ProducerStoreStub;

  beforeEach(() => {
    stub = new ProducerStoreStub();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideStoreStub(stub),
        { provide: BUILD_VERSION, useValue: 'abc1234' },
      ],
    });
  });

  /** The real shell around the real routes, at `url`. */
  async function shellAt(url: string): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(App);
    await RouterTestingHarness.create(url);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the heading and hosts pages in main', async () => {
    // Arrange
    const fixture = TestBed.createComponent(App);

    // Act
    await fixture.whenStable();

    // Assert
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')?.textContent.trim()).toBe('Realtime Market Dashboard');
    expect(host.querySelector('main router-outlet')).not.toBeNull();
  });

  it.each([
    ['/dashboard', 'Dashboard'],
    ['/settings', 'Settings'],
  ])('at %s the nav marks %s as the current page', async (url, current) => {
    // Arrange
    const expected = current;

    // Act
    const host = await shellAt(url);

    // Assert
    const links = [...host.querySelectorAll('nav[aria-label="Main"] a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/settings']);
    const active = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(active.map((a) => a.textContent.trim())).toEqual([expected]);
    expect(active[0]?.classList.contains('active')).toBe(true);
  });

  it('shows the producer state on every page (settings included)', async () => {
    // Arrange
    stub.status.set('paused');

    // Act
    const host = await shellAt('/settings');

    // Assert
    const pill = host.querySelector('header app-pill');
    expect(pill?.textContent.trim()).toBe('Paused');
    expect(pill?.getAttribute('data-tone')).toBe('warning');
    expect(pill?.hasAttribute('aria-live')).toBe(false);
  });

  it('error ⇒ an app-wide alert with the message; Retry calls store.retry() (7.2)', async () => {
    // Arrange
    stub.status.set('error');
    stub.error.set('Could not load the market producer (HTTP 404).');
    const host = await shellAt('/settings');

    // Act
    host.querySelector<HTMLButtonElement>('[role="alert"] button')?.click();

    // Assert
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not load the market producer (HTTP 404).');
    expect(alert?.querySelector('button')?.textContent.trim()).toBe('Retry');
    expect(stub.calls).toEqual(['retry']);
  });

  it('no banner while there is no error', async () => {
    // Arrange
    stub.status.set('running');

    // Act
    const host = await shellAt('/dashboard');

    // Assert
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('the footer names the deployed commit and links the source (8.5)', async () => {
    // Arrange
    const fixture = TestBed.createComponent(App);

    // Act
    await fixture.whenStable();

    // Assert
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    expect(footer?.querySelector('.build')?.textContent).toBe('abc1234');
    expect(footer?.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/vvitkus-dev/findev',
    );
  });
});
