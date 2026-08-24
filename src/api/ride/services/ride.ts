/**
 * ride service
 *
 * B-02: factory default. Blob read/write helpers (knex over the bytea column)
 * are added in Epic C together with the waypoints controller.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::ride.ride');
