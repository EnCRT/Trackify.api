/**
 * profile controller — C-04.
 * GET/PATCH/DELETE /profiles/me (self-service). auth:false + manual auth.
 */

import { factories } from '@strapi/strapi';
import { getAuthenticatedUser } from '../../../utils/request-helpers';

const UID = 'api::profile.profile';

const PATCHABLE = [
  'nickname',
  'first_name',
  'last_name',
  'photo_url',
  'units',
  'language',
  'timezone',
  'privacy_default',
];

export default factories.createCoreController(UID, ({ strapi }) => ({
  // GET /profiles/me — returns (creating if needed) the caller's profile.
  async me(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const profile = await strapi.service(UID).findOrCreateForUser(user.id, {
      nickname: user.username,
    });
    return { data: profile };
  },

  // PATCH /profiles/me — update whitelisted fields on the caller's profile.
  async updateMe(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const profile = await strapi.service(UID).findOrCreateForUser(user.id, {});

    const body = ctx.request.body?.data || {};
    const data: Record<string, any> = {};
    for (const key of PATCHABLE) {
      if (key in body) data[key] = body[key];
    }

    const updated = await strapi.documents(UID).update({
      documentId: (profile as any).documentId,
      data,
    });
    return { data: updated };
  },

  // DELETE /profiles/me — GDPR soft delete (cascade handled by a later job).
  async deleteMe(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const profile = await strapi.service(UID).findOrCreateForUser(user.id, {});
    await strapi.documents(UID).update({
      documentId: (profile as any).documentId,
      data: { deleted_at: new Date().toISOString() } as any,
    });
    ctx.status = 202;
    return { data: { deleted: true } };
  },

  // GET /profiles/me/stats — live Home-statistics aggregate over the caller's
  // rides (P2: cloud-first Home stats; the app falls back to local SQLite).
  async stats(ctx) {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return ctx.unauthorized('Authentication required');

    const stats = await strapi.service(UID).aggregateStatsForUser(user.id);
    return { data: stats };
  },
}));
