/**
 * track router — core CRUD + custom geo endpoints
 *
 * Strapi 5 custom route pattern:
 *   1. Resolve coreRouter.routes (Route[] | (() => Route[]))
 *   2. Spread core routes + append custom ones
 *   3. Export as a flat array
 */

import { factories } from '@strapi/strapi';

const coreRouter = factories.createCoreRouter('api::track.track');

// .routes can be a getter (function) or a plain array — resolve accordingly
const coreRoutes: any[] =
  typeof coreRouter.routes === 'function'
    ? coreRouter.routes()
    : coreRouter.routes;

// Custom geo routes (handler strings are resolved by Strapi at runtime)
const customRoutes = [
  {
    method: 'GET' as const,
    path: '/tracks/nearby',
    handler: 'track.nearby',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET' as const,
    path: '/tracks/:id/waypoints',
    handler: 'track.waypoints',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET' as const,
    path: '/tracks/:id/simplify',
    handler: 'track.simplify',
    config: {
      auth: false,
    },
  },
];

export default [...coreRoutes, ...customRoutes];
