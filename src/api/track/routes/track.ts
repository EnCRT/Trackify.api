/**
 * Track router — core CRUD + custom geo routes
 *
 * Strapi 5 note: routes must export a router object with a lazy `routes` getter.
 * Accessing `.routes` at module top-level fails before content-type registration.
 */

import { factories } from '@strapi/strapi';

// Base core router (lazy — .routes getter resolves after bootstrap)
const router = factories.createCoreRouter('api::track.track') as any;

// Wrap to inject custom routes alongside core ones
const originalRoutesDescriptor = Object.getOwnPropertyDescriptor(
  router,
  'routes'
);

const customRoutes = [
  {
    method: 'GET',
    path: '/tracks/nearby',
    handler: 'track.nearby',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/tracks/:id/waypoints',
    handler: 'track.waypoints',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/tracks/:id/simplify',
    handler: 'track.simplify',
    config: { auth: false },
  },
];

Object.defineProperty(router, 'routes', {
  get() {
    const core = originalRoutesDescriptor?.get
      ? originalRoutesDescriptor.get.call(router)
      : originalRoutesDescriptor?.value ?? [];
    const coreArr = typeof core === 'function' ? core() : core;
    return [...coreArr, ...customRoutes];
  },
  enumerable: true,
  configurable: true,
});

export default router;
