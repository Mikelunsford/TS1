import { describe, expect, it } from 'vitest';

import {
  PhaseStatusSchema,
  ProjectCreateSchema,
  ProjectPatchSchema,
  ProjectPhaseCreateSchema,
  ProjectPhaseReorderSchema,
  ProjectPhaseStatusUpdateSchema,
  ProjectReopenSchema,
  ProjectStateSchema,
  QuoteAcceptSchema,
  QuoteApproveSchema,
  QuoteConvertSchema,
  QuoteCreateSchema,
  QuoteDeclineSchema,
  QuoteLineReorderSchema,
  QuoteLineReplaceSchema,
  QuoteLineUpsertSchema,
  QuoteModeSchema,
  QuotePatchSchema,
  QuoteRequestRevisionsSchema,
  QuoteServiceTypeSchema,
  QuoteStateSchema,
  QuoteSubmitSchema,
} from './types';

/**
 * Unit coverage for the Wave-4 quoting + projects Zod schemas. The contract
 * parity test already enforces structural equality between this file's
 * SPA-side schemas and the `_shared` mirror; these tests pin the semantics
 * callers depend on (defaults, required fields, enum constraints).
 */

describe('QuoteStateSchema', () => {
  it('accepts every prod enum value', () => {
    for (const v of [
      'draft',
      'submitted',
      'revise_requested',
      'approved',
      'project_pending',
      'cancelled',
    ]) {
      expect(() => QuoteStateSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects aspirational values that do not exist on prod', () => {
    expect(() => QuoteStateSchema.parse('sent')).toThrow();
    expect(() => QuoteStateSchema.parse('accepted')).toThrow();
    expect(() => QuoteStateSchema.parse('converted_to_project')).toThrow();
  });
});

describe('ProjectStateSchema', () => {
  it('accepts every prod enum value', () => {
    for (const v of [
      'pending',
      'ready_to_build',
      'in_production',
      'ready_to_ship',
      'completed',
      'cancelled',
    ]) {
      expect(() => ProjectStateSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects unknown values', () => {
    expect(() => ProjectStateSchema.parse('archived')).toThrow();
  });
});

describe('PhaseStatusSchema', () => {
  it('accepts the four CHECK-constraint values', () => {
    for (const v of ['pending', 'active', 'completed', 'cancelled']) {
      expect(() => PhaseStatusSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects unknown values', () => {
    expect(() => PhaseStatusSchema.parse('skipped')).toThrow();
  });
});

describe('QuoteServiceTypeSchema', () => {
  it('matches the prod service_type enum (co_pack | cross_dock)', () => {
    expect(QuoteServiceTypeSchema.parse('co_pack')).toBe('co_pack');
    expect(QuoteServiceTypeSchema.parse('cross_dock')).toBe('cross_dock');
    expect(() => QuoteServiceTypeSchema.parse('install')).toThrow();
  });
});

describe('QuoteCreateSchema', () => {
  it('accepts a minimal draft create with defaults', () => {
    const parsed = QuoteCreateSchema.parse({
      customer_id: '00000000-0000-0000-0000-000000000001',
      customer_name: 'Acme',
      service_type: 'co_pack',
    });
    expect(parsed.origin).toBe('management');
    expect(parsed.mode).toBe('new_quote');
    expect(parsed.materials_only).toBe(false);
  });

  it('rejects an empty customer_name', () => {
    expect(() =>
      QuoteCreateSchema.parse({
        customer_id: '00000000-0000-0000-0000-000000000001',
        customer_name: '',
        service_type: 'co_pack',
      }),
    ).toThrow();
  });

  it('requires a service_type', () => {
    expect(() =>
      QuoteCreateSchema.parse({
        customer_id: '00000000-0000-0000-0000-000000000001',
        customer_name: 'Acme',
      } as never),
    ).toThrow();
  });

  it('accepts a contact_email but rejects garbage email', () => {
    expect(() =>
      QuoteCreateSchema.parse({
        customer_id: '00000000-0000-0000-0000-000000000001',
        customer_name: 'Acme',
        service_type: 'cross_dock',
        contact_email: 'not-an-email',
      }),
    ).toThrow();
  });
});

describe('QuotePatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => QuotePatchSchema.parse({})).not.toThrow();
  });

  it('keeps QuoteModeSchema discrimination on patches', () => {
    expect(() => QuotePatchSchema.parse({ mode: 'revision' })).not.toThrow();
    expect(() => QuotePatchSchema.parse({ mode: 'bogus' as never })).toThrow();
  });
});

describe('Quote workflow body schemas', () => {
  it('QuoteSubmitSchema accepts an empty object and rejects extras', () => {
    expect(() => QuoteSubmitSchema.parse({})).not.toThrow();
    expect(() => QuoteSubmitSchema.parse({ note: 'x' } as never)).toThrow();
  });

  it('QuoteApproveSchema accepts {} only', () => {
    expect(() => QuoteApproveSchema.parse({})).not.toThrow();
  });

  it('QuoteRequestRevisionsSchema requires a non-empty reason', () => {
    expect(() => QuoteRequestRevisionsSchema.parse({ reason: '' })).toThrow();
    expect(() => QuoteRequestRevisionsSchema.parse({ reason: 'price' })).not.toThrow();
  });

  it('QuoteDeclineSchema requires reason', () => {
    expect(() => QuoteDeclineSchema.parse({} as never)).toThrow();
  });

  it('QuoteAcceptSchema accepts an optional note', () => {
    const parsed = QuoteAcceptSchema.parse({ note: 'thanks' });
    expect(parsed.note).toBe('thanks');
    expect(() => QuoteAcceptSchema.parse({})).not.toThrow();
  });

  it('QuoteConvertSchema requires a project_name', () => {
    expect(() => QuoteConvertSchema.parse({ project_name: '' })).toThrow();
    expect(() => QuoteConvertSchema.parse({ project_name: 'Acme Q3' })).not.toThrow();
  });
});

describe('QuoteLineUpsertSchema', () => {
  it('applies cents/discount defaults', () => {
    const parsed = QuoteLineUpsertSchema.parse({
      description: 'Widget',
      quantity: 1,
      unit_price_cents: 100,
      position: 0,
    });
    expect(parsed.discount_cents).toBe(0);
    expect(parsed.unit_cost_cents).toBe(0);
  });

  it('rejects negative discount_cents', () => {
    expect(() =>
      QuoteLineUpsertSchema.parse({
        description: 'Widget',
        quantity: 1,
        unit_price_cents: 100,
        position: 0,
        discount_cents: -1,
      }),
    ).toThrow();
  });

  it('rejects non-positive quantity', () => {
    expect(() =>
      QuoteLineUpsertSchema.parse({
        description: 'Widget',
        quantity: 0,
        unit_price_cents: 100,
        position: 0,
      }),
    ).toThrow();
  });
});

describe('QuoteLineReplaceSchema', () => {
  it('accepts an empty replace (clear)', () => {
    expect(() => QuoteLineReplaceSchema.parse({ lines: [] })).not.toThrow();
  });

  it('rejects more than 500 lines', () => {
    const lines = Array.from({ length: 501 }, (_, i) => ({
      description: `L${i}`,
      quantity: 1,
      unit_price_cents: 1,
      position: i,
    }));
    expect(() => QuoteLineReplaceSchema.parse({ lines })).toThrow();
  });
});

describe('QuoteLineReorderSchema', () => {
  it('requires at least one id', () => {
    expect(() => QuoteLineReorderSchema.parse({ line_ids: [] })).toThrow();
  });

  it('rejects non-uuid', () => {
    expect(() => QuoteLineReorderSchema.parse({ line_ids: ['not-a-uuid'] })).toThrow();
  });
});

describe('ProjectCreateSchema', () => {
  it('applies cents defaults', () => {
    const parsed = ProjectCreateSchema.parse({ name: 'Acme Q3 build' });
    expect(parsed.total_cents).toBe(0);
    expect(parsed.budget_cents).toBe(0);
  });

  it('requires a name', () => {
    expect(() => ProjectCreateSchema.parse({} as never)).toThrow();
  });
});

describe('ProjectPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => ProjectPatchSchema.parse({})).not.toThrow();
  });
});

describe('ProjectReopenSchema', () => {
  it('defaults to in_production', () => {
    expect(ProjectReopenSchema.parse({}).to).toBe('in_production');
  });

  it('rejects pending as a reopen target (handled by workflow assertTransition)', () => {
    // Schema is permissive — only the workflow validator rejects "pending"
    // from "completed". The schema constrains to the two legal targets only.
    expect(() => ProjectReopenSchema.parse({ to: 'pending' } as never)).toThrow();
  });
});

describe('ProjectPhaseCreateSchema', () => {
  it('defaults budget_cents to 0', () => {
    const parsed = ProjectPhaseCreateSchema.parse({ name: 'BOM', position: 0 });
    expect(parsed.budget_cents).toBe(0);
  });

  it('rejects an empty name', () => {
    expect(() => ProjectPhaseCreateSchema.parse({ name: '', position: 0 })).toThrow();
  });
});

describe('ProjectPhaseReorderSchema', () => {
  it('rejects an empty array', () => {
    expect(() => ProjectPhaseReorderSchema.parse({ phase_ids: [] })).toThrow();
  });
});

describe('ProjectPhaseStatusUpdateSchema', () => {
  it('routes through PhaseStatusSchema', () => {
    expect(() => ProjectPhaseStatusUpdateSchema.parse({ status: 'active' })).not.toThrow();
    expect(() =>
      ProjectPhaseStatusUpdateSchema.parse({ status: 'unknown' } as never),
    ).toThrow();
  });
});

describe('QuoteModeSchema', () => {
  it('covers every prod quote_mode value', () => {
    for (const v of ['new_quote', 'revision', 'reorder', 'feasibility_only', 'scope_shift']) {
      expect(() => QuoteModeSchema.parse(v)).not.toThrow();
    }
  });
});
