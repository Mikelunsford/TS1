/**
 * parseExpenseRejection — constitutional invariant: the BE handler stamps
 * the rejection reason into `notes` with a marker prefix in the form
 * `[REJECTED <iso> by <uuid>]: <reason>`. SPA parses it back out.
 */
import { describe, expect, it } from 'vitest';

import { parseExpenseRejection } from '../expensesService';

describe('parseExpenseRejection', () => {
  it('extracts the reason from a single-line stamped note', () => {
    const notes =
      '[REJECTED 2026-05-16T12:34:56Z by 11111111-1111-1111-1111-111111111111]: Receipt is illegible';
    expect(parseExpenseRejection(notes)).toBe('Receipt is illegible');
  });

  it('extracts the last reason when prior notes precede the marker', () => {
    const notes = [
      'Original note from submitter.',
      '[REJECTED 2026-05-16T00:00:00Z by 22222222-2222-2222-2222-222222222222]: Out of policy',
    ].join('\n');
    expect(parseExpenseRejection(notes)).toBe('Out of policy');
  });

  it('returns null for null / empty / unmarked notes', () => {
    expect(parseExpenseRejection(null)).toBeNull();
    expect(parseExpenseRejection('')).toBeNull();
    expect(parseExpenseRejection('Plain note, no marker.')).toBeNull();
  });
});
