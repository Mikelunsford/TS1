/**
 * auth-api — route table.
 * Wave 0 ships only the health endpoint; remaining routes are TODOs.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'auth-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.2
  //   POST   /auth/invite                          — invite a user to the org
  //   POST   /auth/sessions/switch-org             — alias of tenants/:id/switch
  //   POST   /auth/sessions/accept-invite          — accept an emailed invite
  //   POST   /auth/password-reset/request          — start reset flow
  //   POST   /auth/password-reset/confirm          — confirm with token
  //   POST   /auth/mfa/enroll                      — enroll an MFA factor
  //   POST   /auth/mfa/verify                      — verify MFA challenge
  //   POST   /auth/mfa/disable                     — disable MFA factor
  //   GET    /profiles/me                          — read own profile
  //   PATCH  /profiles/me                          — update display_name, avatar, locale, tz
  //   GET    /profiles/:user_id                    — read another member's profile (org-bounded)
  //   POST   /auth/members                         — add member to org
  //   PATCH  /auth/members/:user_id                — change member role / status
  //   DELETE /auth/members/:user_id                — remove member from org
];
