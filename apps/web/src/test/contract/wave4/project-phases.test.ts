import { describe, it, expect } from 'vitest';

import {
  ApiErrSchema,
  PhaseStatusSchema,
  ProjectPhaseCreateSchema,
  ProjectPhasePatchSchema,
  ProjectPhaseReorderSchema,
  ProjectPhaseSchema,
  ProjectPhaseStatusUpdateSchema,
} from '@/lib/types';
import {
  createPhase,
  deletePhase,
  listPhases,
  patchPhase,
  reorderPhases,
  updatePhaseStatus,
} from '@/lib/services/projectPhasesService';

/**
 * Wire-contract tests for `/projects-api/projects/:project_id/phases`. See
 * TS1/09-api/00-API-CONTRACT.md §5.2.
 *
 * Note: the API contract §5.2 used `status: planned|in_progress|blocked|done`;
 * the prod `project_phases.status` CHECK constraint is
 * `pending|active|completed|cancelled` (PhaseStatusSchema). The Zod canon
 * matches the DB; the contract doc is stale. F-Wave4-XX tracks reconcile.
 */

const SAMPLE_PHASE = {
  id: '00000000-0000-0000-0000-000000000401',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  project_id: '00000000-0000-0000-0000-000000000301',
  position: 0,
  name: 'Receive raw materials',
  description: null,
  status: 'pending' as const,
  planned_start_at: null,
  planned_end_at: null,
  actual_start_at: null,
  actual_end_at: null,
  budget_cents: 0,
  notes: null,
  created_at: '2026-05-15T12:00:00+00:00',
  updated_at: '2026-05-15T12:00:00+00:00',
};

describe('Wire contract: /projects-api/projects/:project_id/phases', () => {
  it('ProjectPhaseSchema accepts the canonical row shape', () => {
    const parsed = ProjectPhaseSchema.safeParse(SAMPLE_PHASE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('GET /phases items array parses', () => {
    const items = [
      SAMPLE_PHASE,
      { ...SAMPLE_PHASE, id: '00000000-0000-0000-0000-000000000402', position: 1 },
    ];
    expect(ProjectPhaseSchema.array().safeParse(items).success).toBe(true);
  });

  it('POST /phases requires name + position', () => {
    const ok = { name: 'Pick & pack', position: 1 };
    expect(ProjectPhaseCreateSchema.safeParse(ok).success).toBe(true);
    // Missing name fails.
    expect(ProjectPhaseCreateSchema.safeParse({ position: 0 }).success).toBe(false);
    // Missing position fails (z.number().int() with no default).
    expect(ProjectPhaseCreateSchema.safeParse({ name: 'X' }).success).toBe(false);
    // Negative position fails (nonnegative).
    expect(ProjectPhaseCreateSchema.safeParse({ name: 'X', position: -1 }).success).toBe(false);
  });

  it('PATCH /phases/:phase_id accepts a partial body', () => {
    expect(ProjectPhasePatchSchema.safeParse({ name: 'renamed' }).success).toBe(true);
    expect(ProjectPhasePatchSchema.safeParse({}).success).toBe(true);
  });

  it('POST /phases/reorder requires a non-empty phase_ids uuid array', () => {
    const ok = {
      phase_ids: [
        '00000000-0000-0000-0000-000000000401',
        '00000000-0000-0000-0000-000000000402',
      ],
    };
    expect(ProjectPhaseReorderSchema.safeParse(ok).success).toBe(true);
    expect(ProjectPhaseReorderSchema.safeParse({ phase_ids: [] }).success).toBe(false);
    // 201 phase_ids exceeds max.
    const tooMany = {
      phase_ids: Array.from({ length: 201 }, () => '00000000-0000-0000-0000-000000000401'),
    };
    expect(ProjectPhaseReorderSchema.safeParse(tooMany).success).toBe(false);
  });

  it('PUT /phases/:phase_id/status requires a valid PhaseStatus value', () => {
    for (const s of ['pending', 'active', 'completed', 'cancelled'] as const) {
      expect(ProjectPhaseStatusUpdateSchema.safeParse({ status: s }).success).toBe(true);
    }
    // Old contract-doc names rejected (R-W4-PF reconcile).
    expect(ProjectPhaseStatusUpdateSchema.safeParse({ status: 'in_progress' }).success).toBe(false);
    expect(ProjectPhaseStatusUpdateSchema.safeParse({ status: 'done' }).success).toBe(false);
    // Empty body rejected.
    expect(ProjectPhaseStatusUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('PhaseStatusSchema enum matches the DB CHECK constraint', () => {
    expect(PhaseStatusSchema.options).toEqual(['pending', 'active', 'completed', 'cancelled']);
  });

  it('DELETE /phases/:phase_id error envelope shape', () => {
    const err = { error: { code: 'NOT_FOUND', message: 'phase not found' } };
    expect(ApiErrSchema.safeParse(err).success).toBe(true);
  });

  it('SPA service exports match the route table in §5.2', () => {
    expect(typeof listPhases).toBe('function');
    expect(typeof createPhase).toBe('function');
    expect(typeof patchPhase).toBe('function');
    expect(typeof deletePhase).toBe('function');
    expect(typeof reorderPhases).toBe('function');
    expect(typeof updatePhaseStatus).toBe('function');
  });
});
