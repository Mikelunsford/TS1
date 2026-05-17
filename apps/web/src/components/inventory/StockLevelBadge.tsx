/**
 * StockLevelBadge — colored badge showing qoh / qavailable for an item +
 * warehouse pair. Color follows three rules:
 *   - red:   quantity_available < 0 (oversold)
 *   - amber: 0 <= available <= lowThreshold (default 0)
 *   - green: available > lowThreshold
 *
 * Wave 8f / Phase 13. `quantity_available` on stock_levels is a STORED
 * generated column (qoh - qreserved). The SPA never writes it.
 *
 * UI-audit refactor (2026-05-18): does NOT fold into the shared
 * <StatusBadge> primitive. The display string is dense and idiosyncratic
 * ("5 avail / 7 oh (R 2)"), and the `font-mono` is intentional so the
 * digit columns align in tables. Instead the audit gap is closed by adding
 * (a) a `title` tooltip explaining the avail/oh/R glossary and (b) an
 * `aria-label` that reads naturally to screen readers.
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
  const availNum = stockAsNumber(qavailable);
  const qohNum = stockAsNumber(qoh);
  const reservedNum = qreserved !== undefined ? stockAsNumber(qreserved) : undefined;
  const reservedSeg = reservedNum !== undefined ? ` (R ${reservedNum})` : '';
  const reservedSrSeg = reservedNum !== undefined ? `, ${reservedNum} reserved` : '';
  const ariaLabel = `Stock level: ${availNum} available, ${qohNum} on hand${reservedSrSeg}`;
  const tooltip = 'avail = available to sell · oh = on hand · R = reserved';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium font-mono',
        toneClasses,
        className,
      )}
      data-testid="stock-level-badge"
      data-tone={tone}
      title={tooltip}
      aria-label={ariaLabel}
    >
      {availNum} avail / {qohNum} oh{reservedSeg}
    </span>
  );
}
