/**
 * Color logic + label tests for StockLevelBadge. Wave 8f / Phase 13.
 *
 * Tone rules:
 *   - red    if quantity_available < 0   (oversold)
 *   - amber  if 0 <= available <= lowThreshold
 *   - green  if available > lowThreshold
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StockLevelBadge } from '../StockLevelBadge';
import { stockBadgeTone } from '../stockBadgeTone';

describe('stockBadgeTone', () => {
  it('returns danger for negative available', () => {
    expect(stockBadgeTone(-1)).toBe('danger');
    expect(stockBadgeTone(-0.0001)).toBe('danger');
    expect(stockBadgeTone('-3.5')).toBe('danger');
  });

  it('returns warning for zero / at-threshold available', () => {
    expect(stockBadgeTone(0)).toBe('warning');
    expect(stockBadgeTone(0, 5)).toBe('warning');
    expect(stockBadgeTone(5, 5)).toBe('warning');
    expect(stockBadgeTone('0')).toBe('warning');
  });

  it('returns success for above-threshold available', () => {
    expect(stockBadgeTone(1)).toBe('success');
    expect(stockBadgeTone(6, 5)).toBe('success');
    expect(stockBadgeTone('100')).toBe('success');
  });
});

describe('StockLevelBadge', () => {
  it('renders qoh + available + reserved values and stamps data-tone', () => {
    render(<StockLevelBadge qoh={10} qreserved={2} qavailable={8} />);
    const el = screen.getByTestId('stock-level-badge');
    expect(el).toHaveAttribute('data-tone', 'success');
    expect(el.textContent).toContain('8 avail');
    expect(el.textContent).toContain('10 oh');
    expect(el.textContent).toContain('R 2');
  });

  it('flips to danger when oversold', () => {
    render(<StockLevelBadge qoh={5} qreserved={10} qavailable={-5} />);
    const el = screen.getByTestId('stock-level-badge');
    expect(el).toHaveAttribute('data-tone', 'danger');
  });
});
