/**
 * Device controller — core CRUD + RBAC filtering
 */

import { factories } from '@strapi/strapi';
import { isAdminUser } from '../../../utils/request-helpers';

const UID = 'api::device.device';

/** Connect a device's owner via the document service (no route-level validation). */
async function connectDeviceOwner(
  strapi: any,
  deviceDocumentId: string,
  userId: number | string
): Promise<void> {
  await strapi.documents(UID).update({
    documentId: deviceDocumentId,
    data: { user: userId } as any,
  });
}

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
     * Re-pairing the same serial_number returns the existing device (200),
     * so a re-pair never creates a duplicate (C-04 / contract §6.4).
     */
    async create(ctx) {
      const user = ctx.state.user;
      const data = ctx.request.body?.data || {};

      if (user && data.serial_number) {
        const existing = await strapi.documents(UID).findMany({
          filters: { serial_number: { $eq: data.serial_number } },
          populate: ['user'],
          limit: 1,
        });
        if (existing && existing.length > 0) {
          const e = existing[0] as any;
          // serial_number is globally unique — a device paired by someone else
          // must not be silently re-paired.
          if (e.user?.id && e.user.id !== user.id && !isAdminUser(user)) {
            return ctx.forbidden('Device is already paired with another user');
          }
          // Self-heal: a previous attempt may have died between create and
          // owner-link — (re)connect the owner so the device is never orphaned.
          if (!e.user?.id) {
            await connectDeviceOwner(strapi, e.documentId, user.id);
            const healed = await strapi
              .documents(UID)
              .findOne({ documentId: e.documentId, populate: ['user'] });
            ctx.status = 200;
            return { data: healed };
          }
          ctx.status = 200;
          return { data: e };
        }
      }

      // NOTE: `user` is deliberately NOT injected into ctx.request.body.data.
      // Strapi 5's input validation (throwRestrictedRelations) rejects relations
      // to plugin::users-permissions.user in the body unless the caller role
      // holds plugin::users-permissions.user.find — which must never be granted
      // (it would let any user list all users). The owner is connected after
      // create via the document service, which does not run route-level
      // validation.
      const response = await super.create(ctx);

      const created = (response as any)?.data;
      if (created?.documentId && user) {
        await connectDeviceOwner(strapi, created.documentId, user.id);

        const withOwner = await strapi
          .documents(UID)
          .findOne({ documentId: created.documentId, populate: ['user'] });
        return { data: withOwner };
      }

      return response;
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
