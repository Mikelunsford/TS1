/**
 * Pure math helper extracted from POLineEditor.tsx so the component file
 * only exports React components (react-refresh/only-export-components).
 *
 * Constitutional invariant (F-Wave5-02): line totals are computed with
 * `roundHalfEven`. BE re-computes the same way; SPA shows a byte-equal
 * preview.
 */
import { roundHalfEven } from '@/lib/money';

export function previewLineTotal(quantity: number, unitCostCents: number): number {
  return roundHalfEven(quantity * unitCostCents);
}
