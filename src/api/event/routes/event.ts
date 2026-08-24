/**
 * event router — C-06. Core CRUD + join/leave.
 */

import { factories } from '@strapi/strapi';

const router = factories.createCoreRouter('api::event.event') as any;

const originalRoutesDescriptor = Object.getOwnPropertyDescriptor(router, 'routes');

const customRoutes = [
  { method: 'POST', path: '/events/:id/join', handler: 'event.join', config: { auth: false } },
  { method: 'DELETE', path: '/events/:id/join', handler: 'event.leave', config: { auth: false } },
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
