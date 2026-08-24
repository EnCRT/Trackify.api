/**
 * SyncSession controller — core CRUD + RBAC filtering
 */

import { factories } from '@strapi/strapi';
import { getAuthenticatedUser, isAdminUser } from '../../../utils/request-helpers';

export default factories.createCoreController(
  'api::sync-session.sync-session' as any,
  ({ strapi }) => ({
    /**
     * Override find to restrict users to their own sync sessions.
     * Admins see all.
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
        return ctx.forbidden('You can only access your own sync sessions');
      }

      return entity;
    },

    /**
     * Override create — auto-assign the authenticated user.
     */
    async create(ctx) {
      const user = ctx.state.user;

      // NOTE: `user` is deliberately NOT injected into the request body.
      // Strapi 5's input validation (throwRestrictedRelations) rejects relations
      // to plugin::users-permissions.user in the body unless the caller role
      // holds plugin::users-permissions.user.find — which must never be granted
      // (it would let any user list all users). The owner is connected after
      // create via the document service, which does not run route-level
      // validation.
      const response = await super.create(ctx);

      const created = (response as any)?.data;
      if (created?.documentId && user) {
        await strapi.documents('api::sync-session.sync-session').update({
          documentId: created.documentId,
          data: { user: user.id } as any,
        });
        const withOwner = await strapi
          .documents('api::sync-session.sync-session')
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
          .service('api::sync-session.sync-session')
          .findOne(ctx.params.id, { populate: ['user'] });

        if (!existing) {
          return ctx.notFound('Sync session not found');
        }

        const isAdmin = ctx.state.user.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

        if (!isAdmin && existing?.user?.id !== ctx.state.user.id) {
          return ctx.forbidden('You can only update your own sync sessions');
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
          .service('api::sync-session.sync-session')
          .findOne(ctx.params.id, { populate: ['user'] });

        if (!existing) {
          return ctx.notFound('Sync session not found');
        }

        const isAdmin = ctx.state.user.roles?.some(
          (r: any) => r.type === 'admin' || r.code === 'trackify-super-admin'
        );

        if (!isAdmin && existing?.user?.id !== ctx.state.user.id) {
          return ctx.forbidden('You can only delete your own sync sessions');
        }
      }

      return super.delete(ctx);
    },

    /**
     * POST /sync-sessions/:id/close — finalize a session (C-06).
     * auth:false + manual auth so it works without a role grant.
     */
    async close(ctx) {
      const user = await getAuthenticatedUser(ctx);
      if (!user) return ctx.unauthorized('Authentication required');

      const { id } = ctx.params;
      const session = await strapi
        .documents('api::sync-session.sync-session')
        .findOne({ documentId: id, populate: ['user'] });
      if (!session) return ctx.notFound('Sync session not found');

      if (!isAdminUser(user) && (session as any).user?.id !== user.id) {
        return ctx.forbidden('You can only close your own sync sessions');
      }

      const body = ctx.request.body?.data || {};
      const updated = await strapi.documents('api::sync-session.sync-session').update({
        documentId: id,
        data: {
          status: body.status || 'completed',
          ended_at: body.ended_at || new Date().toISOString(),
          ...(body.device_battery_end !== undefined
            ? { device_battery_end: body.device_battery_end }
            : {}),
          ...(body.files_synced !== undefined ? { files_synced: body.files_synced } : {}),
          ...(body.bytes_transferred !== undefined
            ? { bytes_transferred: body.bytes_transferred }
            : {}),
          ...(body.duration_ms !== undefined ? { duration_ms: body.duration_ms } : {}),
        } as any,
      });

      return { data: updated };
    },
  })
);
