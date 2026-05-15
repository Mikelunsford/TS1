/**
 * auth-api — route table.
 *
 * Wave 1: ships /me (authenticated read) and /sessions/switch-org
 * (authenticated, idempotent). Remaining routes stay TODOs.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { me } from './handlers/me.ts';
import { switchOrg } from './handlers/switch-org.ts';

const BUNDLE = 'auth-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  { method: 'GET', path: '/me', handler: me },
  { method: 'POST', path: '/sessions/switch-org', handler: switchOrg },
  // TODO Wave 2+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.2
  //   POST   /auth/invite                          — invite a user to the org
  //   POST   /auth/sessions/accept-invite          — accept an emailed invite
  //   POST   /auth/password-reset/request          — start reset flow
  //   POST   /auth/password-reset/confirm          — confirm with token
  //   POST   /auth/mfa/enroll                      — enroll an MFA factor
  //   POST   /auth/mfa/verify                      — verify MFA challenge
  //   POST   /auth/mfa/disable                     — disable MFA factor
  //   PATCH  /me                                   — update display_name, photo, locale, tz
  //   GET    /profiles/:user_id                    — read another member's profile (org-bounded)
  //   POST   /auth/members                         — add member to org
  //   PATCH  /auth/members/:user_id                — change member role / status
  //   DELETE /auth/members/:user_id                — remove member from org
];
