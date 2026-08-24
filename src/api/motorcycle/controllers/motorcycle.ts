/**
 * motorcycle controller — C-04.
 * Owner-scoped RBAC, auto-assign owner, conditional engine_cc validation.
 */

import { factories } from '@strapi/strapi';
import { isAdminUser } from '../../../utils/request-helpers';

const UID = 'api::motorcycle.motorcycle';
const ENGINELESS_KINDS = ['bicycle', 'drone'];

export default factories.createCoreController(UID, ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state.user;
    if (isAdminUser(user)) return super.find(ctx);

    // Owner-scoped query via the Document Service (B-06 pattern): the REST
    // query validator rejects relation filters to plugin::users-permissions.user
    // ("Invalid key user"), but strapi.documents().findMany() accepts them.
    // So we bypass validateQuery/sanitizeQuery and hand the merged filter
    // straight to the core service.
    const filters = {
      ...(ctx.query.filters || {}),
      ...(user ? { user: { id: { $eq: user.id } } } : {}),
      deleted_at: { $null: true },
    };

    const { results, pagination } = await strapi.service(UID).find({
      ...ctx.query,
      filters,
    });
    const sanitizedResults = await (this as any).sanitizeOutput(results, ctx);
    return (this as any).transformResponse(sanitizedResults, { pagination });
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;
    const bike = await strapi.documents(UID).findOne({ documentId: id, populate: ['user'] });
    if (!bike || (bike as any).deleted_at) return ctx.notFound('Motorcycle not found');
    if (!isAdminUser(user) && (bike as any).user?.id !== user?.id) {
      return ctx.forbidden('You can only access your own vehicles');
    }
    return super.findOne(ctx);
  },

  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Authentication required');

    const data = ctx.request.body?.data || {};
    const err = validateKindEngine(data.kind, data.engine_cc);
    if (err) return ctx.badRequest(err);

    // NOTE: `user` is deliberately NOT injected into the request body. Strapi
    // 5's input validation (throwRestrictedRelations) rejects relations to
    // plugin::users-permissions.user in the body unless the caller role holds
    // plugin::users-permissions.user.find — which must never be granted (it
    // would let any user list all users). The owner is connected after create
    // via the document service, which does not run route-level validation.
    // The schema marks `user` required, but the entity validator only enforces
    // `required` on scalar attributes (relation validators are mixed()), so an
    // owner-less create succeeds and is linked right after.
    const response = await super.create(ctx);

    const created = (response as any)?.data;
    if (created?.documentId) {
      await strapi.documents(UID).update({
        documentId: created.documentId,
        data: { user: user.id } as any,
      });
      const withOwner = await strapi
        .documents(UID)
        .findOne({ documentId: created.documentId, populate: ['user'] });
      return { data: withOwner };
    }

    return response;
  },

  async update(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;
    const data = ctx.request.body?.data || {};

    const bike = await strapi.documents(UID).findOne({ documentId: id, populate: ['user'] });
    if (!bike) return ctx.notFound('Motorcycle not found');
    if (!isAdminUser(user) && (bike as any).user?.id !== user?.id) {
      return ctx.forbidden('You can only update your own vehicles');
    }

    const kind = data.kind ?? (bike as any).kind;
    const engineCc = data.engine_cc ?? (bike as any).engine_cc;
    const err = validateKindEngine(kind, engineCc);
    if (err) return ctx.badRequest(err);

    return super.update(ctx);
  },

  async delete(ctx) {
    const { id } = ctx.params;
    const user = ctx.state.user;
    const bike = await strapi.documents(UID).findOne({ documentId: id, populate: ['user'] });
    if (!bike) return ctx.notFound('Motorcycle not found');
    if (!isAdminUser(user) && (bike as any).user?.id !== user?.id) {
      return ctx.forbidden('You can only delete your own vehicles');
    }
    const updated = await strapi.documents(UID).update({
      documentId: id,
      data: { deleted_at: new Date().toISOString() } as any,
    });
    return { data: updated };
  },
}));

/** Conditional rule: bicycles/drones must not carry an engine displacement. */
function validateKindEngine(kind: string | undefined, engineCc: any): string | null {
  if (kind && ENGINELESS_KINDS.includes(kind) && Number(engineCc) > 0) {
    return `engine_cc is not applicable for kind "${kind}"`;
  }
  return null;
}
