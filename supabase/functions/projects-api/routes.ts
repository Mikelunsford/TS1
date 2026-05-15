/**
 * projects-api — route table.
 *
 * Wave 4 ships the projects header + phases per
 * TS1/09-api/00-API-CONTRACT.md §5. Close/reopen + phase status routes go
 * through `_shared/workflow.ts#assertTransition`.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  closeProject,
  createProject,
  getProject,
  listProjects,
  patchProject,
  reopenProject,
} from './handlers/projects.ts';
import {
  createPhase,
  deletePhase,
  listPhases,
  patchPhase,
  reorderPhases,
  updatePhaseStatus,
} from './handlers/phases.ts';

const BUNDLE = 'projects-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Projects
  { method: 'GET', path: '/projects', handler: listProjects },
  { method: 'POST', path: '/projects', handler: createProject },
  { method: 'GET', path: '/projects/:id', handler: getProject },
  { method: 'PATCH', path: '/projects/:id', handler: patchProject },
  { method: 'POST', path: '/projects/:id/close', handler: closeProject },
  { method: 'POST', path: '/projects/:id/reopen', handler: reopenProject },

  // Phases
  { method: 'GET', path: '/projects/:project_id/phases', handler: listPhases },
  { method: 'POST', path: '/projects/:project_id/phases', handler: createPhase },
  { method: 'POST', path: '/projects/:project_id/phases/reorder', handler: reorderPhases },
  { method: 'PATCH', path: '/projects/:project_id/phases/:phase_id', handler: patchPhase },
  { method: 'DELETE', path: '/projects/:project_id/phases/:phase_id', handler: deletePhase },
  {
    method: 'PUT',
    path: '/projects/:project_id/phases/:phase_id/status',
    handler: updatePhaseStatus,
  },
];
