/**
 * Temporary debug script to discover all registered Strapi 5 action IDs.
 * Outputs them to a JSON file for analysis.
 */
import type { Core } from '@strapi/strapi';

export async function debugActions(strapi: Core.Strapi): Promise<void> {
  const permissionService = strapi.service('admin::permission');
  const allActions = permissionService.actionProvider.values() as any[];

  strapi.log.info(`Total actions: ${allActions.length}`);

  const grouped: Record<string, string[]> = {};
  for (const a of allActions) {
    const section = a.section || 'unknown';
    if (!grouped[section]) grouped[section] = [];
    grouped[section].push(a.actionId);
  }

  for (const [section, actions] of Object.entries(grouped)) {
    strapi.log.info(`\n=== ${section} (${actions.length}) ===`);
    for (const actionId of actions) {
      strapi.log.info(`  ${actionId}`);
    }
  }
}
