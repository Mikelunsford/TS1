/**
 * Generic single-field dialog used by the quote workflow actions that need a
 * reason / note / email payload before invoking the endpoint. Modal pattern
 * matches `ConvertLeadDialog` (hand-rolled — no Radix). One-field-by-default,
 * with optional second `extra` slot for the convert-to-project dialog.
 */
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'textarea' | 'date';
  required?: boolean;
  initial?: string;
  maxLength?: number;
  placeholder?: string;
}

export interface QuoteActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  fields: FieldDef[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void> | void;
  pending?: boolean;
}

export function QuoteActionDialog({
  open,
  title,
  description,
  submitLabel,
  fields,
  onClose,
  onSubmit,
  pending,
}: QuoteActionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])),
  );

  // Reset when reopened (or when the field set changes).
  useEffect(() => {
    if (open) {
      setValues(Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])));
    }
  }, [open, fields]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Required-field check (browser does it for non-textarea, but textareas
    // don't always honor required via form-validity).
    for (const f of fields) {
      if (f.required && (values[f.key] ?? '').trim() === '') {
        return;
      }
    }
    await onSubmit(values);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quote-action-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-fg/40"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-bg p-6 shadow-lg">
        <h2 id="quote-action-title" className="text-lg font-semibold text-fg">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          {fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-fg">{f.label}</span>
              {f.type === 'textarea' ? (
                <textarea
                  required={f.required}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  maxLength={f.maxLength}
                  rows={4}
                  className="rounded border border-border bg-bg px-3 py-2 text-fg"
                  data-testid={`field-${f.key}`}
                />
              ) : (
                <input
                  type={f.type ?? 'text'}
                  required={f.required}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  maxLength={f.maxLength}
                  placeholder={f.placeholder}
                  className="rounded border border-border bg-bg px-3 py-2 text-fg"
                  data-testid={`field-${f.key}`}
                />
              )}
            </label>
          ))}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className={cn(
                'rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg',
                pending ? 'opacity-60' : 'hover:opacity-90',
              )}
              data-testid="dialog-submit"
            >
              {pending ? 'Working…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
