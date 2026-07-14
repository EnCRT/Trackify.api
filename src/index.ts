import type { Core } from '@strapi/strapi';
import { seedRBAC } from './seed/rbac';

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
    // Seed RBAC roles and permissions on first run
    try {
      await seedRBAC(strapi);
    } catch (error) {
      strapi.log.error('[RBAC Seed] Failed to seed roles:');
      strapi.log.error(error);
    }
  },
};
