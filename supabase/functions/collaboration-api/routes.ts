/**
 * collaboration-api — route table.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  listComments, createComment, patchComment, softDeleteComment,
} from './handlers/comments.ts';
import {
  listAttachments, createAttachment, signUpload, signDownload, softDeleteAttachment,
} from './handlers/attachments.ts';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
} from './handlers/notifications.ts';
import { autocompleteMentions } from './handlers/mentions.ts';

const BUNDLE = 'collaboration-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Comments.
  { method: 'GET',    path: '/comments',                handler: listComments },
  { method: 'POST',   path: '/comments',                handler: createComment },
  { method: 'PATCH',  path: '/comments/:id',            handler: patchComment },
  { method: 'DELETE', path: '/comments/:id',            handler: softDeleteComment },

  // Attachments.
  { method: 'GET',    path: '/attachments',             handler: listAttachments },
  { method: 'POST',   path: '/attachments/sign-upload', handler: signUpload },
  { method: 'POST',   path: '/attachments',             handler: createAttachment },
  { method: 'GET',    path: '/attachments/:id/download',handler: signDownload },
  { method: 'DELETE', path: '/attachments/:id',         handler: softDeleteAttachment },

  // Notifications.
  { method: 'GET',    path: '/notifications',           handler: listNotifications },
  { method: 'PATCH',  path: '/notifications/:id/read',  handler: markNotificationRead },
  { method: 'POST',   path: '/notifications/read-all',  handler: markAllNotificationsRead },

  // Mentions.
  { method: 'GET',    path: '/mentions/autocomplete',   handler: autocompleteMentions },
];

// End Phase 16 (Wave 10 Session 2).
