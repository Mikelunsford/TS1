/**
 * Project phases service. See TS1/09-api/00-API-CONTRACT.md §5.2.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ProjectPhaseSchema,
  type ProjectPhase,
  type ProjectPhaseCreate,
  type ProjectPhasePatch,
  type ProjectPhaseReorder,
  type ProjectPhaseStatusUpdate,
} from '../types';

const PhaseListSchema = z.object({
  items: z.array(ProjectPhaseSchema),
  next_cursor: z.string().nullable(),
});

export function listPhases(projectId: string) {
  return apiRequest({
    method: 'GET',
    path: `/projects-api/projects/${projectId}/phases`,
    schema: PhaseListSchema,
  });
}

export function createPhase(projectId: string, body: ProjectPhaseCreate): Promise<ProjectPhase> {
  return apiRequest({
    method: 'POST',
    path: `/projects-api/projects/${projectId}/phases`,
    body,
    schema: ProjectPhaseSchema,
  });
}

export function patchPhase(
  projectId: string,
  phaseId: string,
  body: ProjectPhasePatch,
): Promise<ProjectPhase> {
  return apiRequest({
    method: 'PATCH',
    path: `/projects-api/projects/${projectId}/phases/${phaseId}`,
    body,
    schema: ProjectPhaseSchema,
  });
}

export function deletePhase(projectId: string, phaseId: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/projects-api/projects/${projectId}/phases/${phaseId}`,
    schema: z.object({ ok: z.literal(true) }),
  });
}

export function reorderPhases(projectId: string, body: ProjectPhaseReorder) {
  return apiRequest({
    method: 'POST',
    path: `/projects-api/projects/${projectId}/phases/reorder`,
    body,
    schema: PhaseListSchema,
  });
}

export function updatePhaseStatus(
  projectId: string,
  phaseId: string,
  body: ProjectPhaseStatusUpdate,
): Promise<ProjectPhase> {
  return apiRequest({
    method: 'PUT',
    path: `/projects-api/projects/${projectId}/phases/${phaseId}/status`,
    body,
    schema: ProjectPhaseSchema,
  });
}
