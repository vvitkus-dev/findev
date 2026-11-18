import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Dashboard } from './features/dashboard/dashboard';
import { Settings } from './features/settings/settings';

describe('app routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it('redirects the empty path to /dashboard', async () => {
    // Arrange
    const harness = await RouterTestingHarness.create();

    // Act
    const page = await harness.navigateByUrl('/', Dashboard);

    // Assert
    expect(page).toBeInstanceOf(Dashboard);
    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('redirects an unknown URL to /dashboard', async () => {
    // Arrange
    const harness = await RouterTestingHarness.create();

    // Act
    await harness.navigateByUrl('/unknown/deep/link');

    // Assert
    expect(TestBed.inject(Router).url).toBe('/dashboard');
    expect(harness.routeNativeElement?.querySelector('h2')?.textContent).toBe('Dashboard');
  });

  it('/settings lazily renders the Settings page', async () => {
    // Arrange
    const harness = await RouterTestingHarness.create();

    // Act
    const page = await harness.navigateByUrl('/settings', Settings);

    // Assert
    expect(page).toBeInstanceOf(Settings);
    expect(harness.routeNativeElement?.querySelector('h2')?.textContent).toBe('Settings');
  });
});
