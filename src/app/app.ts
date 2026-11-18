import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BUILD_VERSION } from './core/build-info';
import { STATUS_VIEW } from './core/producer/producer-status-view';
import { ProducerStore } from './core/producer/producer-store';
import { Pill } from './shared/ui/pill';

/**
 * Application shell: title, main navigation, the producer state (visible on every page) and
 * the app-wide error banner with Retry, plus a footer naming the deployed commit. The pill here is not a live region; the dashboard's
 * status line announces changes, and errors are announced by the banner (`role="alert"`).
 */
@Component({
  selector: 'app-root',
  imports: [Pill, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <header class="shell-header">
      <h1>Realtime Market Dashboard</h1>
      <nav aria-label="Main">
        <a routerLink="/dashboard" routerLinkActive="active" ariaCurrentWhenActive="page">
          Dashboard
        </a>
        <a routerLink="/settings" routerLinkActive="active" ariaCurrentWhenActive="page">
          Settings
        </a>
      </nav>
      <app-pill class="producer-state" [tone]="view().tone">{{ view().label }}</app-pill>
    </header>
    @if (store.error(); as message) {
      <div class="banner" role="alert">
        <span>{{ message }}</span>
        <button type="button" (click)="store.retry()">Retry</button>
      </div>
    }
    <main>
      <router-outlet />
    </main>
    <footer>
      Build <code class="build">{{ version }}</code> ·
      <a href="https://github.com/vvitkus-dev/findev">Source on GitHub</a>
    </footer>
  `,
  styles: `
    /* A full-height column: the routed page fills the space between header and footer, so a
       lazily rendered page never pushes the footer down (no layout shift on load). */
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      font-family: system-ui, sans-serif;
      color: #1b1b1b;
    }
    .shell-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1.5rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid #ddd;
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
    }
    nav {
      display: flex;
      gap: 0.25rem;
    }
    nav a {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
      padding-inline: 0.75rem;
      border-radius: 0.375rem;
      color: inherit;
      text-decoration: none;
    }
    nav a:hover,
    nav a:focus-visible {
      background: #f0f0f0;
    }
    /* No bold on the active link: a wider label would shift its neighbour when the route activates. */
    nav a.active {
      color: #1a56db;
      box-shadow: inset 0 -3px 0 #1a56db;
    }
    /* Wide enough for the longest label ("Initializing"), so status changes never move it. */
    .producer-state {
      margin-inline-start: auto;
      min-width: 7.5rem;
      text-align: center;
    }
    .banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      margin: 0.75rem 1rem 0;
      padding: 0.5rem 0.75rem;
      border: 1px solid #b3261e;
      border-radius: 0.375rem;
      background: #fdf0ef;
      color: #b3261e;
    }
    .banner button {
      min-height: 2.75rem;
      padding-inline: 1rem;
    }
    main {
      flex: 1;
      padding: 1rem;
    }
    footer {
      padding: 0.75rem 1rem;
      border-top: 1px solid #ddd;
      color: #555;
      font-size: 0.875rem;
    }
    footer a {
      color: #1a56db;
    }
    @media (max-width: 36rem) {
      .producer-state {
        margin-inline-start: 0;
      }
      main {
        padding: 0.75rem 0.5rem;
      }
    }
  `,
})
export class App {
  protected readonly store = inject(ProducerStore);
  protected readonly view = computed(() => STATUS_VIEW[this.store.status()]);
  protected readonly version = inject(BUILD_VERSION);
}
