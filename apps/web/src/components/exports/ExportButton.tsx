/**
 * ExportButton — Phase 20 (Wave 10).
 *
 * Triggers a CSV download from `exports-api`. Hits
 * `GET /exports-api/exports/<entity>?format=csv` with the user's bearer
 * token, reads the streamed response into a Blob, and uses an in-DOM anchor
 * click to save it. No external libs — pure browser APIs.
 *
 * Usage:
 *   <ExportButton entity="vendors" label="Export" />
 *
 * Capabilities are enforced server-side (the underlying handler calls
 * requireCap); the button itself is always rendered. Server returns 403 +
 * FORBIDDEN if the caller lacks the read cap.
 */

import { useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface ExportButtonProps {
  /** URL slug used in the exports-api path, e.g. 'vendors', 'purchase_orders'. */
  entity: string;
  /** Optional label override. */
  label?: string;
  /** Optional extra query params (e.g. { expand: 'lines' }). */
  params?: Record<string, string>;
  /** Optional class merge for layout. */
  className?: string;
}

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function ExportButton({
  entity,
  label = 'Export CSV',
  params,
  className = '',
}: ExportButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('not signed in');
      }
      const sp = new URLSearchParams({ format: 'csv' });
      if (params) {
        for (const [k, v] of Object.entries(params)) sp.set(k, v);
      }
      const url = `${apiBaseUrl}/exports-api/exports/${entity}?${sp.toString()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Export failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const today = new Date().toISOString().slice(0, 10);
      const filename = `${entity}-${today}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted disabled:opacity-50"
        aria-busy={busy}
      >
        {busy ? 'Exporting…' : label}
      </button>
      {err && (
        <span role="alert" className="text-xs text-error">
          {err}
        </span>
      )}
    </div>
  );
}

export default ExportButton;
