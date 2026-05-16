/**
 * CSV export button for report pages.
 *
 * Phase 19 (Wave 10 Session 3) — R-W10-RPT-01 close-out.
 *
 * Pre-Phase-19 (Wave 10 Session 1) this was a feature-flag-gated stub. The
 * exports-api now ships report CSV streams (handlers/reports.ts), so the
 * `reports.csv_export` flag is removed and the button always wires to the
 * real download endpoint. It builds a query string from `params`, fetches
 * with the Supabase access token, and triggers a browser download via a
 * synthetic anchor click.
 */
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

const REPORT_PATH: Record<string, string> = {
  'ar-aging':            '/exports-api/exports/reports/ar-aging',
  'sales-by-customer':   '/exports-api/exports/reports/sales-by-customer',
  'sales-by-item':       '/exports-api/exports/reports/sales-by-item',
  'cash-position':       '/exports-api/exports/reports/cash-position',
  'expense-by-category': '/exports-api/exports/reports/expense-by-category',
};

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`;

export interface ReportExportButtonProps {
  reportKey: string;
  /** Filters appended to the URL — e.g. { as_of, currency } or { start, end, currency }. */
  params?: Record<string, string | number | null | undefined>;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function ReportExportButton({ reportKey, params }: ReportExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = REPORT_PATH[reportKey];
  const supported = Boolean(path);

  async function onExport(): Promise<void> {
    if (!path) return;
    setError(null);
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const query = qs(params ?? {});
      const url = `${apiBaseUrl}${path}${query ? `?${query}` : ''}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: token ? `Bearer ${token}` : '',
          apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      // Prefer the filename the server suggested.
      const cd = res.headers.get('content-disposition') ?? '';
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m?.[1] ?? `${reportKey}-${new Date().toISOString().slice(0, 10)}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={!supported || busy}
        onClick={() => { void onExport(); }}
        title={supported ? 'Export to CSV' : `Export not available for '${reportKey}'`}
        aria-label={`Export ${reportKey} to CSV`}
        data-testid={`report-export-${reportKey}`}
        className="rounded-md border border-border bg-bg px-3 py-1 text-sm font-medium text-fg hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Exporting...' : 'Export CSV'}
      </button>
      {error && <span className="text-xs text-error">Export failed: {error}</span>}
    </div>
  );
}
