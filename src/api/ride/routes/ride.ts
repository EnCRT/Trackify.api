/**
 * ride router — core CRUD + custom binary waypoints routes (C-02).
 *
 * The custom routes use `auth: false` and authenticate manually in the
 * controller (getAuthenticatedUser) so they don't depend on users-permissions
 * role grants. Core CRUD routes use the default policy (permissions seeded for
 * the `authenticated` role in src/seed/permissions.ts).
 */

import { factories } from '@strapi/strapi';

const router = factories.createCoreRouter('api::ride.ride') as any;

const originalRoutesDescriptor = Object.getOwnPropertyDescriptor(router, 'routes');

const customRoutes = [
  {
    method: 'PUT',
    path: '/rides/:id/waypoints',
    handler: 'ride.uploadWaypoints',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/rides/:id/waypoints',
    handler: 'ride.downloadWaypoints',
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
