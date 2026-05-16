/**
 * Tone selector for StockLevelBadge — extracted to satisfy
 * react-refresh/only-export-components (StockLevelBadge.tsx is a
 * component-only file).
 *
 * Wave 8f / Phase 13.
 */
function asNumber(n: number | string): number {
  if (typeof n === 'number') return n;
  const parsed = Number.parseFloat(n);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function stockBadgeTone(
  qavailable: number | string,
  lowThreshold = 0,
): 'danger' | 'warning' | 'success' {
  const v = asNumber(qavailable);
  if (v < 0) return 'danger';
  if (v <= lowThreshold) return 'warning';
  return 'success';
}

export { asNumber as stockAsNumber };
