/**
 * event controller — C-06.
 * Public read; organizer auto-assigned on create; join/leave participation.
 */

import { factories } from '@strapi/strapi';
import { getAuthenticatedUser } from '../../../utils/request-helpers';

const UID = 'api::event.event';

export default factories.createCoreController(UID, ({ strapi }) => ({
  async create(ctx) {
    const user = ctx.state.user;

    // NOTE: `organizer` is deliberately NOT injected into the request body.
    // Strapi 5's input validation (throwRestrictedRelations) rejects relations
    // to plugin::users-permissions.user in the body unless the caller role
    // holds plugin::users-permissions.user.find — which must never be granted
    // (it would let any user list all users). The organizer is connected after
    // create via the document service, which does not run route-level
    // validation.
    const response = await super.create(ctx);

    const created = (response as any)?.data;
    if (created?.documentId && user) {
      await strapi.documents(UID).update({
        documentId: created.documentId,
        data: { organizer: user.id } as any,
      });
      const withOrganizer = await strapi
        .documents(UID)
        .findOne({ documentId: created.documentId, populate: ['organizer'] });
      return { data: withOrganizer };
    }

    return response;
  },

  // POST /events/:id/join
  async join(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const { id } = ctx.params;
    const event = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['participants'] });
    if (!event) return ctx.notFound('Event not found');

    const already = ((event as any).participants || []).some((p: any) => p.id === user.id);
    if (!already) {
      await strapi.documents(UID).update({
        documentId: id,
        data: { participants: { connect: [user.id] } } as any,
      });
    }

    const updated = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['participants'] });
    return {
      data: { joined: true, participant_count: ((updated as any).participants || []).length },
    };
  },

  // DELETE /events/:id/join
  async leave(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const { id } = ctx.params;
    const event = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['participants'] });
    if (!event) return ctx.notFound('Event not found');

    await strapi.documents(UID).update({
      documentId: id,
      data: { participants: { disconnect: [user.id] } } as any,
    });

    const updated = await strapi
      .documents(UID)
      .findOne({ documentId: id, populate: ['participants'] });
    return {
      data: { left: true, participant_count: ((updated as any).participants || []).length },
    };
  },
}));
