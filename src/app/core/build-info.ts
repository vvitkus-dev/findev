import { InjectionToken } from '@angular/core';

/** Replaced at build time via `define` (angular.json default "dev"; CI passes the short commit SHA). */
declare const BUILD_SHA: string | undefined;

/** Short commit SHA of this build, shown in the footer so a deploy can be traced to its commit. */
export const BUILD_VERSION = new InjectionToken<string>('buildVersion', {
  factory: () => (typeof BUILD_SHA === 'string' ? BUILD_SHA : 'dev'),
});
