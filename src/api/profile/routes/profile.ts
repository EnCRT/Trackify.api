/**
 * profile router — C-04.
 * /profiles/me self-service routes (auth:false + manual auth) alongside core CRUD.
 * Core CRUD stays admin-only (no `authenticated` grant seeded for profiles).
 */

import { factories } from '@strapi/strapi';

const router = factories.createCoreRouter('api::profile.profile') as any;

const originalRoutesDescriptor = Object.getOwnPropertyDescriptor(router, 'routes');

const customRoutes = [
  { method: 'GET', path: '/profiles/me', handler: 'profile.me', config: { auth: false } },
  { method: 'PUT', path: '/profiles/me', handler: 'profile.updateMe', config: { auth: false } },
  { method: 'PATCH', path: '/profiles/me', handler: 'profile.updateMe', config: { auth: false } },
  { method: 'DELETE', path: '/profiles/me', handler: 'profile.deleteMe', config: { auth: false } },
  { method: 'GET', path: '/profiles/me/stats', handler: 'profile.stats', config: { auth: false } },
];

Object.defineProperty(router, 'routes', {
  get() {
    const core = originalRoutesDescriptor?.get
      ? originalRoutesDescriptor.get.call(router)
      : originalRoutesDescriptor?.value ?? [];
    const coreArr = typeof core === 'function' ? core() : core;
    return [...customRoutes, ...coreArr];
  },
  enumerable: true,
  configurable: true,
});

export default router;
