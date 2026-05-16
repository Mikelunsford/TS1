/**
 * StockLevelBadge — colored badge showing qoh / qavailable for an item +
 * warehouse pair. Color follows three rules:
 *   - red:   quantity_available < 0 (oversold)
 *   - amber: 0 <= available <= lowThreshold (default 0)
 *   - green: available > lowThreshold
 *
 * Wave 8f / Phase 13. `quantity_available` on stock_levels is a STORED
 * generated column (qoh - qreserved). The SPA never writes it.
 */
import { cn } from '@/lib/cn';

import { stockAsNumber, stockBadgeTone } from './stockBadgeTone';

export interface StockLevelBadgeProps {
  qoh: number | string;
  qreserved?: number | string;
  qavailable: number | string;
  /** Threshold at/under which we colour amber. Defaults to 0. */
  lowThreshold?: number;
  className?: string;
}

export function StockLevelBadge({
  qoh,
  qreserved,
  qavailable,
  lowThreshold = 0,
  className,
}: StockLevelBadgeProps) {
  const tone = stockBadgeTone(qavailable, lowThreshold);
  const toneClasses =
    tone === 'danger'
      ? 'bg-danger/10 text-danger ring-1 ring-danger/30'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning ring-1 ring-warning/30'
        : 'bg-success/10 text-success ring-1 ring-success/30';
  const reservedSeg = qreserved !== undefined ? ` (R ${stockAsNumber(qreserved)})` : '';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium font-mono',
        toneClasses,
        className,
      )}
      data-testid="stock-level-badge"
      data-tone={tone}
    >
      {stockAsNumber(qavailable)} avail / {stockAsNumber(qoh)} oh{reservedSeg}
    </span>
  );
}
