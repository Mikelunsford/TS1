/**
 * Projects service. See TS1/09-api/00-API-CONTRACT.md §5.1.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ProjectSchema,
  type Project,
  type ProjectClose,
  type ProjectCreate,
  type ProjectPatch,
  type ProjectReopen,
} from '../types';

const ProjectListSchema = z.object({
  items: z.array(ProjectSchema),
  next_cursor: z.string().nullable(),
});

export interface ProjectListFilters {
  q?: string;
  status?: string;
  customer_id?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ProjectListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listProjects(filters?: ProjectListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/projects-api/projects${toQuery(filters)}`,
    schema: ProjectListSchema,
  });
}

export function getProject(id: string): Promise<Project> {
  return apiRequest({
    method: 'GET',
    path: `/projects-api/projects/${id}`,
    schema: ProjectSchema,
  });
}

export function createProject(body: ProjectCreate): Promise<Project> {
  return apiRequest({
    method: 'POST',
    path: '/projects-api/projects',
    body,
    schema: ProjectSchema,
  });
}

export function updateProject(id: string, body: ProjectPatch): Promise<Project> {
  return apiRequest({
    method: 'PATCH',
    path: `/projects-api/projects/${id}`,
    body,
    schema: ProjectSchema,
  });
}

export function closeProject(id: string, body: ProjectClose = {}): Promise<Project> {
  return apiRequest({
    method: 'POST',
    path: `/projects-api/projects/${id}/close`,
    body,
    schema: ProjectSchema,
  });
}

export function reopenProject(
  id: string,
  body: ProjectReopen = { to: 'in_production' },
): Promise<Project> {
  return apiRequest({
    method: 'POST',
    path: `/projects-api/projects/${id}/reopen`,
    body,
    schema: ProjectSchema,
  });
}
