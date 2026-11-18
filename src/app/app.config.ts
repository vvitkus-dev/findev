import type { ApplicationConfig } from '@angular/core';
import { inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { ProducerStore } from './core/producer/producer-store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Creates the one producer worker and starts run 1 before the first page renders.
    provideAppInitializer(() => {
      inject(ProducerStore).boot();
    }),
  ],
};
