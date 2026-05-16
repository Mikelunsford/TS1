/**
 * ImportWizard — Phase 20 (Wave 10).
 *
 * 3-step modal: Upload → Preview → Commit. Wraps the imports-api validate-
 * then-commit flow. Step 1 reads a File, base64-encodes it, POSTs the
 * dry-run preview. Step 2 shows row errors + first-20 valid rows; the
 * commit button is disabled if any errors. Step 3 POSTs commit and toasts
 * success + invalidates the list query via the supplied callback.
 *
 * Usage:
 *   <ImportWizard entity="customers" open={open} onClose={() => setOpen(false)}
 *                 onCommitted={() => qc.invalidateQueries(customerKeys.all)} />
 */

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { apiRequest, ApiError } from '@/lib/apiClient';

const PreviewResponseSchema = z.object({
  import_id: z.string(),
  errors: z.array(
    z.object({
      row: z.number(),
      field: z.string(),
      message: z.string(),
    }),
  ),
  preview: z.array(z.record(z.unknown())),
  stats: z.object({
    total_rows: z.number(),
    valid_rows: z.number(),
    error_rows: z.number(),
  }),
});

const CommitResponseSchema = z.object({
  inserted_count: z.number(),
  failed_rows: z.array(
    z.object({
      row: z.number(),
      field: z.string(),
      message: z.string(),
    }),
  ),
});

export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;
export type CommitResponse = z.infer<typeof CommitResponseSchema>;

export interface ImportWizardProps {
  /** URL slug for imports-api, e.g. 'customers' | 'items' | 'vendors'. */
  entity: 'customers' | 'items' | 'vendors';
  open: boolean;
  onClose: () => void;
  /** Called after commit succeeds — parent should invalidate its list query. */
  onCommitted?: (result: CommitResponse) => void;
}

type Step = 'upload' | 'preview' | 'commit' | 'done';

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function ImportWizard({
  entity,
  open,
  onClose,
  onCommitted,
}: ImportWizardProps): JSX.Element | null {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [csvB64, setCsvB64] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset when reopened.
  useEffect(() => {
    if (open) {
      setStep('upload');
      setFile(null);
      setCsvB64(null);
      setPreview(null);
      setCommitResult(null);
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function handlePreview(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const b64 = await fileToBase64(file);
      setCsvB64(b64);
      const res = await apiRequest({
        method: 'POST',
        path: `/imports-api/imports/${entity}`,
        body: { csv_b64: b64, dry_run: true },
        schema: PreviewResponseSchema,
      });
      setPreview(res);
      setStep('preview');
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit(): Promise<void> {
    if (!csvB64) return;
    setBusy(true);
    setErr(null);
    try {
      setStep('commit');
      const res = await apiRequest({
        method: 'POST',
        path: `/imports-api/imports/${entity}/commit`,
        body: { csv_b64: csvB64 },
        schema: CommitResponseSchema,
      });
      setCommitResult(res);
      setStep('done');
      onCommitted?.(res);
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
      setStep('preview');
    } finally {
      setBusy(false);
    }
  }

  const previewFirst = preview && preview.preview.length > 0 ? preview.preview[0] : undefined;
  const previewColumns = previewFirst ? Object.keys(previewFirst) : [];
  const canCommit = preview !== null && preview.errors.length === 0 && preview.stats.valid_rows > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      ref={dialogRef}
      onClick={(e) => {
        if (e.target === dialogRef.current && !busy) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-bg shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="import-wizard-title" className="text-lg font-semibold">
            Import {entity}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-fg-muted hover:text-fg disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {/* Step indicator */}
          <ol className="flex items-center gap-2 text-xs text-fg-subtle" aria-label="Import progress">
            <li className={step === 'upload' ? 'font-semibold text-fg' : ''}>1. Upload</li>
            <li aria-hidden="true">/</li>
            <li className={step === 'preview' ? 'font-semibold text-fg' : ''}>2. Preview</li>
            <li aria-hidden="true">/</li>
            <li className={step === 'commit' || step === 'done' ? 'font-semibold text-fg' : ''}>
              3. Commit
            </li>
          </ol>

          {/* Step 1 */}
          {step === 'upload' && (
            <div className="space-y-3">
              <label htmlFor="import-file" className="block text-sm font-medium">
                Choose a CSV file
              </label>
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              <p className="text-xs text-fg-subtle">
                The first row must be the header. Required columns depend on the entity.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-sm hover:bg-bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={!file || busy}
                  className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Validating…' : 'Validate'}
                </button>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 'preview' && preview && (
            <div className="space-y-3">
              <p className="text-sm">
                Parsed <strong>{preview.stats.total_rows}</strong> row(s) —{' '}
                <span className="text-success">{preview.stats.valid_rows} valid</span>,{' '}
                <span className="text-error">{preview.stats.error_rows} with errors</span>.
              </p>

              {preview.errors.length > 0 && (
                <div className="rounded-md border border-error/40 bg-error/5 p-3" role="alert">
                  <h3 className="mb-2 text-sm font-semibold text-error">Row errors</h3>
                  <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                    {preview.errors.slice(0, 50).map((e, i) => (
                      <li key={`${e.row}-${e.field}-${i}`}>
                        Row {e.row}, field <code>{e.field}</code>: {e.message}
                      </li>
                    ))}
                    {preview.errors.length > 50 && (
                      <li className="text-fg-subtle">
                        … and {preview.errors.length - 50} more
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {previewColumns.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full divide-y divide-border text-xs">
                    <thead className="bg-bg-muted">
                      <tr>
                        {previewColumns.map((c) => (
                          <th key={c} className="px-2 py-1 text-left font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.preview.map((row, i) => (
                        <tr key={i}>
                          {previewColumns.map((c) => (
                            <td key={c} className="px-2 py-1">
                              {String(row[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-sm hover:bg-bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-sm hover:bg-bg-muted"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={!canCommit || busy}
                  className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
                  title={!canCommit ? 'Fix all errors before committing' : ''}
                >
                  {busy ? 'Committing…' : `Commit ${preview.stats.valid_rows} row(s)`}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 commit-in-flight */}
          {step === 'commit' && (
            <p className="text-sm text-fg-muted" role="status">
              Committing…
            </p>
          )}

          {/* Done */}
          {step === 'done' && commitResult && (
            <div className="space-y-3">
              <p className="text-sm text-success" role="status">
                Imported {commitResult.inserted_count} row(s).
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {err && step !== 'commit' && (
            <p role="alert" className="text-sm text-error">
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportWizard;
