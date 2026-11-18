import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Application shell. Navigation and the producer status bar are added in Phase 7. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <header class="shell-header">
      <h1>Realtime Market Dashboard</h1>
    </header>
    <main>
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      font-family: system-ui, sans-serif;
    }
    .shell-header {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #ddd;
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
    }
    main {
      padding: 1rem;
    }
  `,
})
export class App {}
