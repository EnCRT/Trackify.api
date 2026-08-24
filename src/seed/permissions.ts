/**
 * API permission seed (C-04..C-06).
 *
 * Grants the users-permissions `authenticated` and `public` roles the core CRUD
 * actions for Trackify content types, so the mobile app's REST calls work out of
 * the box (ownership is still enforced inside each controller).
 *
 * Custom routes (waypoints, /profiles/me, join, close, leaderboard, nearby) are
 * `auth: false` and authenticate manually, so they need no grant here.
 *
 * Idempotent and defensive: safe on every boot; a failure to grant one action is
 * logged and skipped rather than aborting bootstrap.
 */

import type { Core } from '@strapi/strapi';

const crud = (uid: string) =>
  ['find', 'findOne', 'create', 'update', 'delete'].map((a) => `${uid}.${a}`);

const AUTHENTICATED_ACTIONS = [
  ...crud('api::ride.ride'),
  ...crud('api::motorcycle.motorcycle'),
  ...crud('api::device.device'),
  ...crud('api::sync-session.sync-session'),
  ...crud('api::event.event'),
  ...crud('api::circuit.circuit'),
];

// Public reads for shared/reference content.
const PUBLIC_ACTIONS = [
  'api::circuit.circuit.find',
  'api::circuit.circuit.findOne',
  'api::event.event.find',
  'api::event.event.findOne',
];

async function grant(
  strapi: Core.Strapi,
  roleType: 'authenticated' | 'public',
  actions: string[]
): Promise<void> {
  const role = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: roleType } });

  if (!role) {
    strapi.log.warn(`[perm-seed] role "${roleType}" not found — skipping.`);
    return;
  }

  let created = 0;
  for (const action of actions) {
    try {
      const existing = await strapi.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: role.id } });
      if (!existing) {
        await strapi.db
          .query('plugin::users-permissions.permission')
          .create({ data: { action, role: role.id } });
        created++;
      }
    } catch (err: any) {
      strapi.log.warn(`[perm-seed] ${roleType}:${action} skipped: ${err?.message || err}`);
    }
  }
  strapi.log.info(`[perm-seed] role "${roleType}": +${created} new permission(s).`);
}

export async function seedApiPermissions(strapi: Core.Strapi): Promise<void> {
  await grant(strapi, 'authenticated', AUTHENTICATED_ACTIONS);
  await grant(strapi, 'public', PUBLIC_ACTIONS);
}
