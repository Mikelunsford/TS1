import { describe, it, expect } from 'vitest';

import {
  ApiErrSchema,
  ProjectCloseSchema,
  ProjectCreateSchema,
  ProjectPatchSchema,
  ProjectReopenSchema,
  ProjectSchema,
} from '@/lib/types';
import {
  closeProject,
  createProject,
  getProject,
  listProjects,
  reopenProject,
  updateProject,
} from '@/lib/services/projectsService';

/**
 * Wire-contract tests for `/projects-api/projects`. See TS1/09-api/00-API-CONTRACT.md §5.1.
 *
 * Note: the API contract §5.1 says ProjectCreate uses `display_name` and
 * `source_quote_id`; the BE shipped in PR #38 + the Zod canon use `name`
 * and `quote_id` (matches prod `projects` columns). See F-Wave4-09 carryover
 * in the journal. The Zod canon is the source of truth on the wire.
 */

const SAMPLE_PROJECT = {
  id: '00000000-0000-0000-0000-000000000301',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  project_number: 'P-2026-0001',
  quote_id: '00000000-0000-0000-0000-000000000001',
  customer_id: '00000000-0000-0000-0000-000000000002',
  customer_name: 'Acme Co.',
  name: 'Acme Co-Pack Q3',
  status: 'pending' as const,
  currency_code: 'USD',
  total_cents: 250000,
  budget_cents: 200000,
  due_date: null,
  invoice_id: null,
  bom_finalized_at: null,
  bom_finalized_by: null,
  ready_to_build_at: null,
  sent_to_production_at: null,
  production_started_at: null,
  production_completed_at: null,
  ready_to_ship_at: null,
  shipping_completed_at: null,
  created_at: '2026-05-15T12:00:00+00:00',
  updated_at: '2026-05-15T12:00:00+00:00',
};

describe('Wire contract: /projects-api/projects', () => {
  it('ProjectSchema accepts the canonical row shape', () => {
    const parsed = ProjectSchema.safeParse(SAMPLE_PROJECT);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('GET /projects items array parses', () => {
    const items = [
      SAMPLE_PROJECT,
      { ...SAMPLE_PROJECT, id: '00000000-0000-0000-0000-000000000302', status: 'in_production' as const },
    ];
    expect(ProjectSchema.array().safeParse(items).success).toBe(true);
  });

  it('POST /projects accepts a minimum-required create body', () => {
    const ok = { name: 'Acme Co-Pack Q3' };
    expect(ProjectCreateSchema.safeParse(ok).success).toBe(true);
    // Empty body fails (name is required).
    expect(ProjectCreateSchema.safeParse({}).success).toBe(false);
  });

  it('PATCH /projects/:id accepts a partial body', () => {
    expect(ProjectPatchSchema.safeParse({ name: 'updated' }).success).toBe(true);
    expect(ProjectPatchSchema.safeParse({}).success).toBe(true);
  });

  it('POST /projects/:id/close accepts an optional reason', () => {
    expect(ProjectCloseSchema.safeParse({}).success).toBe(true);
    expect(ProjectCloseSchema.safeParse({ reason: 'shipped' }).success).toBe(true);
  });

  it('POST /projects/:id/reopen has a default `to=in_production`', () => {
    const empty = ProjectReopenSchema.safeParse({});
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.to).toBe('in_production');
    }
    expect(ProjectReopenSchema.safeParse({ to: 'ready_to_ship' }).success).toBe(true);
    // Invalid target rejected.
    expect(ProjectReopenSchema.safeParse({ to: 'pending' }).success).toBe(false);
  });

  it('error responses use the standard envelope { error: { code, message } }', () => {
    const err = {
      error: { code: 'STATE_CONFLICT', message: 'illegal transition completed -> pending' },
    };
    expect(ApiErrSchema.safeParse(err).success).toBe(true);
  });

  it('SPA service exports match the route table in §5.1', () => {
    expect(typeof listProjects).toBe('function');
    expect(typeof getProject).toBe('function');
    expect(typeof createProject).toBe('function');
    expect(typeof updateProject).toBe('function');
    expect(typeof closeProject).toBe('function');
    expect(typeof reopenProject).toBe('function');
  });
});
