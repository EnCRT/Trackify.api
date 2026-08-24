/**
 * SyncSession router — core CRUD + close (C-06).
 */

import { factories } from '@strapi/strapi';

const router = factories.createCoreRouter('api::sync-session.sync-session' as any) as any;

const originalRoutesDescriptor = Object.getOwnPropertyDescriptor(router, 'routes');

const customRoutes = [
  {
    method: 'POST',
    path: '/sync-sessions/:id/close',
    handler: 'sync-session.close',
    config: { auth: false },
  },
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
