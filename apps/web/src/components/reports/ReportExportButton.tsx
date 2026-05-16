import { useIsFlagOn } from '@/lib/hooks/useOrgFlags';

/**
 * CSV export button for report pages.
 *
 * Wave 10 / Phase 18 polish: the export endpoints themselves (Agent A2,
 * Phase 20 exports+imports) are not yet shipped, so we render the button
 * but gate it behind the `reports.csv_export` org flag — which returns
 * false today on every org. Once Agent A2 lands the endpoint and the
 * flag flips on, this becomes the live download trigger.
 *
 * TODO(wave10-A2-handoff): wire `onExport` to the real
 *   GET /finance-api/reports/<report>/export?... endpoint and stream the
 *   response to a Blob -> a.click() download. Until then, the button is
 *   visible but disabled with a tooltip.
 */
export interface ReportExportButtonProps {
  reportKey: string;
  /** Called when the flag is on; otherwise the button stays disabled. */
  onExport?: () => void | Promise<void>;
}

export function ReportExportButton({ reportKey, onExport }: ReportExportButtonProps) {
  const { isOn, isLoading } = useIsFlagOn('reports.csv_export');
  const disabled = !isOn || isLoading;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!isOn) return;
        if (onExport) void onExport();
      }}
      title={isOn ? 'Export to CSV' : 'CSV export coming soon (Phase 20)'}
      aria-label={`Export ${reportKey} to CSV`}
      data-testid={`report-export-${reportKey}`}
      className="rounded-md border border-border bg-bg px-3 py-1 text-sm font-medium text-fg hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export CSV
    </button>
  );
}
