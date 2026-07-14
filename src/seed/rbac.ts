/**
 * RBAC Seed Script — Trackify
 *
 * Creates 3 roles with granular permissions:
 * - Super Admin: full access (all permissions)
 * - Moderator: content management (CRUD + publish + media + user management)
 * - Content Editor: content creation & editing (CRUD own, read all)
 *
 * Called from src/index.ts bootstrap on first run.
 *
 * Strapi 5 note: content-type actions (section === 'contentTypes') require a
 * valid `subject` matching action.subjects. Non-content-type actions use
 * subject: null. This seed uses the same approach as Strapi's built-in
 * createRolesIfNoneExist — expand content-type actions via
 * getPermissionsWithNestedFields.
 */

import type { Core } from '@strapi/strapi';

// ── Helpers ─────────────────────────────────────────────────────────────────

function getPermissionService(strapi: Core.Strapi) {
  return strapi.service('admin::permission') as any;
}

function getRoleService(strapi: Core.Strapi) {
  return strapi.service('admin::role') as any;
}

function getContentTypeService(strapi: Core.Strapi) {
  return strapi.service('admin::content-type') as any;
}

// ── Action Matching ─────────────────────────────────────────────────────────

function actionMatchesPattern(actionId: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return actionId === prefix || actionId.startsWith(prefix + '.');
  }
  if (pattern.endsWith('*')) {
    return actionId.startsWith(pattern.slice(0, -1));
  }
  return actionId === pattern;
}

function actionMatchesAny(actionId: string, patterns: string[]): boolean {
  return patterns.some((p) => actionMatchesPattern(actionId, p));
}

// ── Role Definitions ────────────────────────────────────────────────────────

interface RoleDef {
  code: string;
  name: string;
  description: string;
  /** Action patterns to include */
  includeActions: string[];
  /** Action patterns to exclude (takes priority over includes) */
  excludeActions: string[];
}

const ROLE_DEFINITIONS: RoleDef[] = [
  {
    code: 'trackify-super-admin',
    name: 'Trackify Super Admin',
    description:
      'Полный доступ ко всем разделам админ-панели, контенту, настройкам и пользователям.',
    includeActions: ['*'],
    excludeActions: [],
  },
  {
    code: 'trackify-moderator',
    name: 'Trackify Moderator',
    description:
      'Управление контентом: создание, редактирование, публикация, удаление записей. Доступ к медиа-библиотеке. Управление пользователями.',
    includeActions: [
      'plugin::content-manager.explorer.create',
      'plugin::content-manager.explorer.read',
      'plugin::content-manager.explorer.update',
      'plugin::content-manager.explorer.delete',
      'plugin::content-manager.explorer.publish',
      'plugin::upload.read',
      'plugin::upload.assets.create',
      'plugin::upload.assets.update',
      'plugin::upload.assets.download',
      'plugin::upload.assets.copy-link',
      'plugin::upload.configure-view',
      'plugin::upload.settings.read',
      'admin::users.create',
      'admin::users.read',
      'admin::users.update',
      'plugin::content-type-builder.read',
      'admin::marketplace.read',
      'admin::provider-login.read',
    ],
    excludeActions: [
      'admin::roles.*',
      'admin::api-tokens.*',
      'admin::transfer-tokens.*',
      'admin::audit-logs.*',
      'admin::webhooks.*',
      'admin::users.delete',
    ],
  },
  {
    code: 'trackify-content-editor',
    name: 'Trackify Content Editor',
    description:
      'Создание и редактирование контента. Просмотр всех записей. Доступ к медиа-библиотеке для загрузки файлов.',
    includeActions: [
      'plugin::content-manager.explorer.create',
      'plugin::content-manager.explorer.read',
      'plugin::content-manager.explorer.update',
      'plugin::upload.read',
      'plugin::upload.assets.create',
      'plugin::upload.assets.update',
      'plugin::upload.assets.download',
      'plugin::upload.assets.copy-link',
    ],
    excludeActions: [
      'plugin::content-manager.explorer.delete',
      'plugin::content-manager.explorer.publish',
      'admin::*',
      'plugin::content-type-builder.*',
    ],
  },
];

// ── Main Seed Function ──────────────────────────────────────────────────────

export async function seedRBAC(strapi: Core.Strapi): Promise<void> {
  const roleService = getRoleService(strapi);
  const permissionService = getPermissionService(strapi);
  const contentTypeService = getContentTypeService(strapi);

  strapi.log.info('[RBAC Seed] Starting role & permission seeding...');

  // 1. Get all registered actions
  const allActions: any[] = permissionService.actionProvider.values();
  const contentTypesActions = allActions.filter(
    (a) => a.section === 'contentTypes'
  );
  const nonContentTypesActions = allActions.filter(
    (a) => a.section !== 'contentTypes'
  );

  strapi.log.info(
    `[RBAC Seed] Found ${allActions.length} actions ` +
    `(${contentTypesActions.length} content-type, ${nonContentTypesActions.length} other).`
  );

  // 2. Create roles
  for (const def of ROLE_DEFINITIONS) {
    const existing = await roleService.exists({ code: def.code });

    if (existing) {
      strapi.log.info(
        `[RBAC Seed] Role "${def.name}" already exists, skipping.`
      );
      continue;
    }

    strapi.log.info(`[RBAC Seed] Creating role: ${def.name} (${def.code})...`);

    const role = await roleService.create({
      name: def.name,
      code: def.code,
      description: def.description,
    });

    // 3. Filter actions matching include/exclude patterns
    const matchFilter = (action: any) => {
      const included = actionMatchesAny(action.actionId, def.includeActions);
      const excluded =
        def.excludeActions.length > 0 &&
        actionMatchesAny(action.actionId, def.excludeActions);
      return included && !excluded;
    };

    const matchedContentTypeActions = contentTypesActions.filter(matchFilter);
    const matchedNonContentTypeActions =
      nonContentTypesActions.filter(matchFilter);

    // 4. Build permissions
    // Content-type actions: expand per subject (like Strapi's built-in logic)
    const contentTypePermissions = contentTypeService.getPermissionsWithNestedFields(
      matchedContentTypeActions
    );

    // Non-content-type actions: subject is null
    const nonContentTypePermissions = matchedNonContentTypeActions.map(
      (action: any) => ({
        action: action.actionId,
        subject: null as string | null,
        conditions: [] as string[],
      })
    );

    const allPermissions = [
      ...contentTypePermissions,
      ...nonContentTypePermissions,
    ];

    strapi.log.info(
      `[RBAC Seed] Assigning ${allPermissions.length} permissions ` +
      `(${contentTypePermissions.length} content-type, ` +
      `${nonContentTypePermissions.length} other) to "${def.name}"...`
    );

    await roleService.assignPermissions(role.id, allPermissions);

    strapi.log.info(
      `[RBAC Seed] ✓ Role "${def.name}" created with ${allPermissions.length} permissions.`
    );
  }

  strapi.log.info('[RBAC Seed] RBAC seeding complete.');
}
