/**
 * RateInputPercent tests — verifies wire-format decimal <-> display percent
 * conversion in both directions.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { RateInputPercent } from './RateInputPercent';

function Wrapper({
  initial,
  onChangeSpy,
}: {
  initial: number;
  onChangeSpy: (n: number) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <RateInputPercent
      value={v}
      onChange={(n) => {
        setV(n);
        onChangeSpy(n);
      }}
      data-testid="rate-input"
    />
  );
}

describe('RateInputPercent', () => {
  it('renders the wire-format decimal as a percent display (0.0875 -> "8.75")', () => {
    render(<Wrapper initial={0.0875} onChangeSpy={vi.fn()} />);
    const input = screen.getByTestId('rate-input') as HTMLInputElement;
    expect(input.value).toBe('8.75');
  });

  it('calls onChange with decimal 0..1 when user types a percent (8.75 -> 0.0875)', () => {
    const spy = vi.fn();
    render(<Wrapper initial={0} onChangeSpy={spy} />);
    const input = screen.getByTestId('rate-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8.75' } });
    expect(spy).toHaveBeenCalled();
    const last = spy.mock.calls.at(-1)?.[0] as number;
    expect(last).toBeCloseTo(0.0875, 6);
  });

  it('clears to 0 when the user empties the field', () => {
    const spy = vi.fn();
    render(<Wrapper initial={0.05} onChangeSpy={spy} />);
    const input = screen.getByTestId('rate-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(spy).toHaveBeenLastCalledWith(0);
  });

  it('renders 0 as empty-ish (no extra trailing zeros)', () => {
    render(<Wrapper initial={0} onChangeSpy={vi.fn()} />);
    const input = screen.getByTestId('rate-input') as HTMLInputElement;
    expect(input.value).toBe('0');
  });
});
