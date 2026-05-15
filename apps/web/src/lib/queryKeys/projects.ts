/**
 * Projects query keys.
 */
import type { ProjectListFilters } from '../services/projectsService';

export const projectKeys = {
  all: ['projects', 'projects'] as const,
  list: (filters: ProjectListFilters = {}) => [...projectKeys.all, 'list', filters] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
  phases: (projectId: string) => [...projectKeys.all, 'phases', projectId] as const,
};
