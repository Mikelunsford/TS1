/**
 * settings-api — route table (Phase 15).
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  bulkUpdateSettings,
  getAllSettingsForMe,
  listSettingsByGroup,
  upsertSetting,
} from './handlers/settings.ts';
import { getFlagsForMe } from './handlers/flags.ts';
import { listNumberingForMe, updateNumberingForKind } from './handlers/numbering.ts';

const BUNDLE = 'settings-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Settings (Phase 15) — flags read with no cap; writes admin+.
  { method: 'GET',  path: '/settings/me/all',         handler: getAllSettingsForMe },
  { method: 'GET',  path: '/settings/me/flags',       handler: getFlagsForMe },
  { method: 'GET',  path: '/settings/numbering',      handler: listNumberingForMe },
  { method: 'PUT',  path: '/settings/numbering/:doc_type', handler: updateNumberingForKind },
  { method: 'GET',  path: '/settings/:group',         handler: listSettingsByGroup },
  { method: 'PUT',  path: '/settings/:group/:key',    handler: upsertSetting },
  { method: 'POST', path: '/settings/bulk-update',    handler: bulkUpdateSettings },
];
