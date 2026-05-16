/**
 * previewLineTotal — line total preview honours the constitutional
 * half-even rounding rule (F-Wave5-02). BE re-computes via the same
 * `roundHalfEven` helper, so the SPA preview is byte-equal.
 */
import { describe, expect, it } from 'vitest';

import { previewLineTotal } from '../poLineMath';

describe('previewLineTotal', () => {
  it('rounds half-even on a .5 boundary that rounds to even', () => {
    // 0.5 → 0 (banker's rounding to nearest even).
    expect(previewLineTotal(1, 0.5)).toBe(0);
  });

  it('rounds half-even when the .5 boundary rounds up to even', () => {
    // 1.5 → 2.
    expect(previewLineTotal(1, 1.5)).toBe(2);
  });

  it('handles plain integer multiplication', () => {
    expect(previewLineTotal(3, 100)).toBe(300);
  });

  it('handles fractional quantities', () => {
    // 2.5 * 100 = 250 (no rounding boundary).
    expect(previewLineTotal(2.5, 100)).toBe(250);
  });
});
