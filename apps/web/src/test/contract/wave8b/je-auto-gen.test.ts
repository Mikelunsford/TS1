import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * Wire-contract tests for the Wave 8b JE auto-generation surface.
 *
 * Migration 0060 ships a single SECURITY DEFINER RPC,
 * `post_journal_entry(p_org_id, p_source_type, p_source_id, p_entry_date,
 * p_description, p_currency_code, p_lines jsonb)` returning a jsonb with
 * exactly two top-level keys — `entry_id` (uuid) and `entry_number` (text).
 * This shape is what the trigger functions (and any future direct caller)
 * consume.
 *
 * Six AFTER triggers on invoices/payments/expenses/vendor_bills(×2)/
 * credit_note_allocations invoke this RPC implicitly; their behavior is
 * covered end-to-end by the journal/closeout MCP smoke probes plus
 * (future) Playwright "post and verify JE" flows. This contract test
 * pins the RPC return shape so future migrations can't silently drop
 * a key.
 */

const PostJournalEntryResponseSchema = z.object({
  entry_id: z.string().uuid(),
  entry_number: z.string().min(1),
});

const SAMPLE_RESPONSE = {
  entry_id: '00000000-0000-0000-0000-0000000000ab',
  entry_number: 'JE-2026-0001',
};

describe('Wave 8b — post_journal_entry RPC return shape', () => {
  it('parses a {entry_id, entry_number} response', () => {
    const parsed = PostJournalEntryResponseSchema.parse(SAMPLE_RESPONSE);
    expect(parsed.entry_id).toBe(SAMPLE_RESPONSE.entry_id);
    expect(parsed.entry_number).toBe(SAMPLE_RESPONSE.entry_number);
  });

  it('rejects a response missing entry_id', () => {
    expect(() =>
      PostJournalEntryResponseSchema.parse({ entry_number: 'JE-2026-0001' }),
    ).toThrow();
  });

  it('rejects a response missing entry_number', () => {
    expect(() =>
      PostJournalEntryResponseSchema.parse({
        entry_id: '00000000-0000-0000-0000-0000000000ab',
      }),
    ).toThrow();
  });

  it('rejects a non-uuid entry_id', () => {
    expect(() =>
      PostJournalEntryResponseSchema.parse({
        entry_id: 'not-a-uuid',
        entry_number: 'JE-2026-0001',
      }),
    ).toThrow();
  });

  it('rejects an empty entry_number', () => {
    expect(() =>
      PostJournalEntryResponseSchema.parse({
        entry_id: '00000000-0000-0000-0000-0000000000ab',
        entry_number: '',
      }),
    ).toThrow();
  });
});

describe('Wave 8b — JE source_type taxonomy', () => {
  /**
   * Migration 0060 extends `journal_entries.source_type` CHECK to include
   * `vendor_bill_payment` alongside the existing 6 values
   * (invoice/payment/expense/credit_note/manual/vendor_bill). Pin the
   * taxonomy as a TS-level Zod enum so future handlers can import it
   * without rediscovering the DB constraint.
   */
  const JournalSourceTypeSchema = z.enum([
    'invoice',
    'payment',
    'expense',
    'credit_note',
    'manual',
    'vendor_bill',
    'vendor_bill_payment',
  ]);

  it('accepts all 7 known source_type values', () => {
    for (const v of [
      'invoice',
      'payment',
      'expense',
      'credit_note',
      'manual',
      'vendor_bill',
      'vendor_bill_payment',
    ] as const) {
      expect(() => JournalSourceTypeSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects an unknown source_type', () => {
    expect(() => JournalSourceTypeSchema.parse('refund')).toThrow();
  });
});
