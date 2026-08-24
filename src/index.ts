import type { Core } from '@strapi/strapi';
import { seedRBAC } from './seed/rbac';
import { seedApiPermissions } from './seed/permissions';
import { ensureSchema } from './utils/ensure-schema';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // B-02/B-10: add the BYTEA waypoints_blob column + scalar indexes.
    // Runs after Strapi's schema sync, so all tables already exist.
    try {
      await ensureSchema(strapi);
    } catch (error) {
      strapi.log.error('[ensure-schema] Failed:');
      strapi.log.error(error);
    }

    // Seed RBAC roles and permissions on first run
    try {
      await seedRBAC(strapi);
    } catch (error) {
      strapi.log.error('[RBAC Seed] Failed to seed roles:');
      strapi.log.error(error);
    }

    // Grant authenticated/public roles the API permissions (C-04..C-06)
    try {
      await seedApiPermissions(strapi);
    } catch (error) {
      strapi.log.error('[perm-seed] Failed to seed API permissions:');
      strapi.log.error(error);
    }
  },
};
