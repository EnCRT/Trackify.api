/**
 * Device controller — core CRUD + RBAC filtering
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::device.device' as any,
  ({ strapi }) => ({
    /**
     * Override find to restrict users to their own devices.
     * Admins see all devices.
     */
    async find(ctx) {
      const { state } = ctx;
      const user = state.user;

      if (
        user?.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        )
      ) {
        return super.find(ctx);
      }

      if (user) {
        ctx.query = {
          ...ctx.query,
          filters: {
            ...(ctx.query.filters || {}),
            user: { id: { $eq: user.id } },
          },
        };
      }

      return super.find(ctx);
    },

    /**
     * Override findOne — same RBAC as find.
     */
    async findOne(ctx) {
      const { state } = ctx;
      const user = state.user;

      const entity = await super.findOne(ctx);
      if (!entity) return entity;

      if (
        user?.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        )
      ) {
        return entity;
      }

      const data = (entity as any)?.data ?? entity;
      if (data?.user?.id !== user?.id) {
        return ctx.forbidden('You can only access your own devices');
      }

      return entity;
    },

    /**
     * Override create — auto-assign the authenticated user.
     */
    async create(ctx) {
      if (ctx.state.user) {
        ctx.request.body.data = {
          ...(ctx.request.body.data || {}),
          user: ctx.state.user.id,
        };
      }

      return super.create(ctx);
    },

    /**
     * Override update — ownership check.
     */
    async update(ctx) {
      if (ctx.state.user) {
        const existing = await strapi
          .service('api::device.device')
          .findOne(ctx.params.id, { populate: ['user'] });

        if (!existing) {
          return ctx.notFound('Device not found');
        }

        const isAdmin = ctx.state.user.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

        if (!isAdmin && existing?.user?.id !== ctx.state.user.id) {
          return ctx.forbidden('You can only update your own devices');
        }
      }

      return super.update(ctx);
    },

    /**
     * Override delete — ownership check.
     */
    async delete(ctx) {
      if (ctx.state.user) {
        const existing = await strapi
          .service('api::device.device')
          .findOne(ctx.params.id, { populate: ['user'] });

        if (!existing) {
          return ctx.notFound('Device not found');
        }

        const isAdmin = ctx.state.user.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

        if (!isAdmin && existing?.user?.id !== ctx.state.user.id) {
          return ctx.forbidden('You can only delete your own devices');
        }
      }

      return super.delete(ctx);
    },
  })
);
