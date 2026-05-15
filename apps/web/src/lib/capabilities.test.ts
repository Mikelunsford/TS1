/**
 * Capability matrix tests. Keep in step with `_shared/capabilities.ts`.
 * The SPA mirror is not a contract test (contract test scope is types.ts +
 * workflow.ts byte-mirror), but the role policy here is load-bearing for
 * button visibility so a focused unit test is worth its weight.
 */
import { describe, expect, it } from 'vitest';

import { can } from './capabilities';

describe('SPA capabilities mirror', () => {
  it('grants full reach to org_owner and org_admin', () => {
    expect(can('org_owner', 'quotes.write')).toBe(true);
    expect(can('org_admin', 'quotes.approve')).toBe(true);
    expect(can('org_admin', 'quotes.convert')).toBe(true);
    expect(can('org_owner', 'projects.write')).toBe(true);
  });

  it('lets sales drive quotes but not approve projects', () => {
    expect(can('sales', 'quotes.read')).toBe(true);
    expect(can('sales', 'quotes.write')).toBe(true);
    expect(can('sales', 'quotes.approve')).toBe(true);
    expect(can('sales', 'quotes.send')).toBe(true);
    expect(can('sales', 'quotes.convert')).toBe(true);
    expect(can('sales', 'projects.read')).toBe(true);
    expect(can('sales', 'projects.write')).toBe(false);
  });

  it('lets viewer read quotes but never write or approve', () => {
    expect(can('viewer', 'quotes.read')).toBe(true);
    expect(can('viewer', 'quotes.write')).toBe(false);
    expect(can('viewer', 'quotes.approve')).toBe(false);
    expect(can('viewer', 'quotes.convert')).toBe(false);
    expect(can('viewer', 'crm.customers.read')).toBe(true);
    expect(can('viewer', 'crm.customers.write')).toBe(false);
  });

  it('denies caps for null role', () => {
    expect(can(null, 'quotes.read')).toBe(false);
    expect(can(undefined, 'quotes.read')).toBe(false);
  });

  it('lets ops read quotes but not write them', () => {
    expect(can('ops', 'quotes.read')).toBe(true);
    expect(can('ops', 'quotes.write')).toBe(false);
    expect(can('ops', 'quotes.approve')).toBe(false);
    expect(can('ops', 'projects.write')).toBe(true);
  });
});
