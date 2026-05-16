import { describe, it, expect } from 'vitest';

import { formatNumber, matchesDocNumber, DOC_KINDS } from '@/lib/numbering';

/**
 * Phase 14 — numbering format unit tests.
 *
 * Pins the prefix + year + lpad(N, pad) shape that the SECURITY DEFINER
 * RPC `public.next_doc_number()` emits for yearly-reset doc types.
 * Drift here = drift between SPA placeholder rendering and what the
 * backend will actually allocate.
 */

describe('formatNumber — yearly reset shape', () => {
  it('pads to 5 digits with leading zeros', () => {
    expect(formatNumber('INV-', 2026, 1, 5)).toBe('INV-2026-00001');
    expect(formatNumber('INV-', 2026, 42, 5)).toBe('INV-2026-00042');
    expect(formatNumber('INV-', 2026, 99999, 5)).toBe('INV-2026-99999');
  });

  it('keeps natural width when value exceeds pad', () => {
    expect(formatNumber('Q-', 2026, 100000, 5)).toBe('Q-2026-100000');
  });

  it('handles 4-digit pad (legacy ops prefixes)', () => {
    expect(formatNumber('T1-RO-', 2026, 7, 4)).toBe('T1-RO-2026-0007');
  });

  it('handles empty prefix', () => {
    expect(formatNumber('', 2026, 9, 5)).toBe('2026-00009');
  });

  it('covers all 12 canonical prefixes', () => {
    const samples: Record<string, string> = {
      quote:           'Q-',
      invoice:         'INV-',
      credit_note:     'CN-',
      payment:         'PMT-',
      project:         'PRJ-',
      purchase_order:  'PO-',
      vendor_bill:     'VB-',
      expense:         'EXP-',
      journal_entry:   'JE-',
      receiving_order: 'RO-',
      production_run:  'PR-',
      shipment:        'SH-',
    };
    for (const kind of DOC_KINDS) {
      expect(samples).toHaveProperty(kind);
      const sample = formatNumber(samples[kind]!, 2026, 1, 5);
      expect(matchesDocNumber(sample, samples[kind]!, 5)).toBe(true);
    }
  });
});

describe('matchesDocNumber — strict regex guard', () => {
  it('accepts a valid 5-digit yearly invoice number', () => {
    expect(matchesDocNumber('INV-2026-00042', 'INV-', 5)).toBe(true);
  });

  it('rejects wrong year width', () => {
    expect(matchesDocNumber('INV-26-00042', 'INV-', 5)).toBe(false);
  });

  it('rejects wrong padding width', () => {
    expect(matchesDocNumber('INV-2026-42', 'INV-', 5)).toBe(false);
  });

  it('rejects wrong prefix', () => {
    expect(matchesDocNumber('Q-2026-00042', 'INV-', 5)).toBe(false);
  });

  it('rejects regex-special chars unsafely by literal-escaping the prefix', () => {
    expect(matchesDocNumber('T1-RO-2026-0007', 'T1-RO-', 4)).toBe(true);
    expect(matchesDocNumber('T1-RO-2026-0007', 'T1RO-', 4)).toBe(false);
  });
});
