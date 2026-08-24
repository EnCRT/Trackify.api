/**
 * Circuit router — core CRUD + custom geo routes.
 *
 * Renamed from the old `track` router (task B-01). Paths /tracks → /circuits.
 *
 * Strapi 5 note: routes must export a router object with a lazy `routes` getter.
 * Accessing `.routes` at module top-level fails before content-type registration.
 */

import { factories } from '@strapi/strapi';

const router = factories.createCoreRouter('api::circuit.circuit') as any;

const originalRoutesDescriptor = Object.getOwnPropertyDescriptor(
  router,
  'routes'
);

const customRoutes = [
  {
    method: 'GET',
    path: '/circuits/nearby',
    handler: 'circuit.nearby',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/circuits/:id/leaderboard',
    handler: 'circuit.leaderboard',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/circuits/:id/waypoints',
    handler: 'circuit.waypoints',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/circuits/:id/simplify',
    handler: 'circuit.simplify',
    config: { auth: false },
  },
];

Object.defineProperty(router, 'routes', {
  get() {
    const core = originalRoutesDescriptor?.get
      ? originalRoutesDescriptor.get.call(router)
      : originalRoutesDescriptor?.value ?? [];
    const coreArr = typeof core === 'function' ? core() : core;
    // Custom routes first so static paths (e.g. /circuits/nearby) win over the
    // core /circuits/:id param route.
    return [...customRoutes, ...coreArr];
  },
  enumerable: true,
  configurable: true,
});

export default router;
