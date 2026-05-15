import { describe, expect, it } from 'vitest';

import {
  ActivityCreateSchema,
  ContactUpsertSchema,
  CustomerCreateSchema,
  CustomerPatchSchema,
  LeadConvertSchema,
  LeadCreateSchema,
  OpportunityCreateSchema,
  OpportunityStageUpdateSchema,
} from './types';

/**
 * Unit coverage for the Wave-2 CRM Zod schemas. The contract parity test
 * already enforces structural equality between this file and the _shared
 * mirror; these tests pin the semantics callers depend on (defaults,
 * required fields, enum membership).
 */

describe('CustomerCreateSchema', () => {
  it('accepts a minimal company customer', () => {
    const parsed = CustomerCreateSchema.parse({ display_name: 'Acme' });
    expect(parsed.kind).toBe('company');
    expect(parsed.tags).toEqual([]);
  });

  it('rejects empty display_name', () => {
    expect(() => CustomerCreateSchema.parse({ display_name: '' })).toThrow();
  });

  it('accepts a 3-letter currency code', () => {
    const parsed = CustomerCreateSchema.parse({
      display_name: 'Acme',
      default_currency_code: 'USD',
    });
    expect(parsed.default_currency_code).toBe('USD');
  });

  it('rejects a 2-letter currency code', () => {
    expect(() =>
      CustomerCreateSchema.parse({
        display_name: 'Acme',
        default_currency_code: 'US',
      }),
    ).toThrow();
  });
});

describe('CustomerPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => CustomerPatchSchema.parse({})).not.toThrow();
  });
});

describe('ContactUpsertSchema', () => {
  it('requires customer_id and first_name', () => {
    expect(() => ContactUpsertSchema.parse({ first_name: 'Jane' })).toThrow();
  });

  it('defaults is_primary to false', () => {
    const parsed = ContactUpsertSchema.parse({
      customer_id: '00000000-0000-0000-0000-000000000001',
      first_name: 'Jane',
    });
    expect(parsed.is_primary).toBe(false);
  });
});

describe('LeadCreateSchema', () => {
  it('defaults source to inbound and status to new', () => {
    const parsed = LeadCreateSchema.parse({ display_name: 'Acme RFI' });
    expect(parsed.source).toBe('inbound');
    expect(parsed.status).toBe('new');
    expect(parsed.estimated_value_cents).toBe(0);
  });

  it('rejects status=converted on create (use convert endpoint)', () => {
    expect(() =>
      LeadCreateSchema.parse({ display_name: 'Acme RFI', status: 'converted' as never }),
    ).toThrow();
  });
});

describe('LeadConvertSchema', () => {
  it('requires opportunity_name', () => {
    expect(() => LeadConvertSchema.parse({})).toThrow();
  });

  it('defaults amount_cents to 0 and create_customer to false', () => {
    const parsed = LeadConvertSchema.parse({ opportunity_name: 'Acme Pilot' });
    expect(parsed.opportunity_amount_cents).toBe(0);
    expect(parsed.create_customer).toBe(false);
  });
});

describe('OpportunityCreateSchema', () => {
  it('requires customer_id, display_name, amount_cents, currency_code', () => {
    expect(() => OpportunityCreateSchema.parse({})).toThrow();
  });

  it('accepts a valid opportunity', () => {
    const parsed = OpportunityCreateSchema.parse({
      customer_id: '00000000-0000-0000-0000-000000000001',
      display_name: 'Acme Pilot',
      amount_cents: 1_000_000,
      currency_code: 'USD',
    });
    expect(parsed.stage).toBe('prospect');
    expect(parsed.amount_cents).toBe(1_000_000);
  });

  it('rejects negative amount_cents', () => {
    expect(() =>
      OpportunityCreateSchema.parse({
        customer_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'X',
        amount_cents: -1,
        currency_code: 'USD',
      }),
    ).toThrow();
  });
});

describe('OpportunityStageUpdateSchema', () => {
  it('accepts the seven valid stages', () => {
    for (const stage of [
      'prospect',
      'discovery',
      'proposal',
      'negotiation',
      'won',
      'lost',
      'abandoned',
    ] as const) {
      expect(OpportunityStageUpdateSchema.parse({ stage }).stage).toBe(stage);
    }
  });

  it('rejects unknown stage', () => {
    expect(() => OpportunityStageUpdateSchema.parse({ stage: 'frozen' })).toThrow();
  });
});

describe('ActivityCreateSchema', () => {
  it('requires entity_type, entity_id, kind, subject', () => {
    expect(() => ActivityCreateSchema.parse({})).toThrow();
  });

  it('accepts a complete activity', () => {
    const parsed = ActivityCreateSchema.parse({
      entity_type: 'customer',
      entity_id: '00000000-0000-0000-0000-000000000001',
      kind: 'call',
      subject: 'Quarterly sync',
    });
    expect(parsed.kind).toBe('call');
  });

  it('rejects unsupported entity_type', () => {
    expect(() =>
      ActivityCreateSchema.parse({
        entity_type: 'bogus',
        entity_id: '00000000-0000-0000-0000-000000000001',
        kind: 'note',
        subject: 'x',
      }),
    ).toThrow();
  });
});
