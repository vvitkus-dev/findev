import type { Routes } from '@angular/router';
import { Dashboard } from './features/dashboard/dashboard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  // Eager: it is the landing page, so lazy loading only added two requests (its 1.7 kB chunk and
  // a shared chunk) in a row before first paint. Settings stays lazy (Signal Forms, ~17 kB).
  { path: 'dashboard', title: 'Dashboard · Realtime Market', component: Dashboard },
  {
    path: 'settings',
    title: 'Settings · Realtime Market',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: 'dashboard' },
];
