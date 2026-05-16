/**
 * SettingsForm — field-map-driven editor for one settings group.
 *
 * Phase 15. Consumes a list of field descriptors + the current value map,
 * tracks dirty state, persists via a bulk-update mutation, and surfaces
 * basic validation. Each save emits a fresh idempotency-key automatically
 * via apiClient (settingsService → apiRequest with method !== GET).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/apiClient';
import { settingsKeys } from '@/lib/queryKeys/settings';
import { bulkUpdateSettings } from '@/lib/services/settingsService';

import { EnumListEditor } from './EnumListEditor';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'cents'
  | 'boolean'
  | 'color'
  | 'enum-list';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  description?: string;
  /** Validator. Returns error string or null. */
  validate?: (v: unknown) => string | null;
  /** Render-time placeholder. */
  placeholder?: string;
}

interface Props {
  group: string;
  fields: FieldDef[];
  initialValues: Record<string, unknown>;
  /** Render a child below the form (e.g. preview panes). */
  children?: React.ReactNode;
}

function coerce(kind: FieldKind, raw: string): unknown {
  if (kind === 'number' || kind === 'cents') {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (kind === 'boolean') return raw === 'true';
  if (raw === '') return null;
  return raw;
}

function display(value: unknown, kind: FieldKind): string {
  if (value == null) return '';
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function SettingsForm({ group, fields, initialValues, children }: Props) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>({ ...initialValues });
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const dirty = useMemo(() => {
    return Object.keys(values).some((k) => values[k] !== initialValues[k]);
  }, [values, initialValues]);

  const mutation = useMutation({
    mutationFn: (items: Array<{ group: string; key: string; value: unknown }>) =>
      bulkUpdateSettings(items),
    onSuccess: () => {
      toast.success('Settings saved');
      void qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error('Save failed');
    },
  });

  const onSave = () => {
    const newErrors: Record<string, string | null> = {};
    for (const f of fields) {
      const v = values[f.key];
      const err = f.validate ? f.validate(v) : null;
      if (err) newErrors[f.key] = err;
    }
    setErrors(newErrors);
    if (Object.values(newErrors).some((e) => e !== null)) {
      toast.error('Please fix validation errors before saving');
      return;
    }
    const changedItems = fields
      .filter((f) => values[f.key] !== initialValues[f.key])
      .map((f) => ({ group, key: f.key, value: values[f.key] ?? null }));
    if (changedItems.length === 0) return;
    mutation.mutate(changedItems);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {fields.map((f) => {
          const current = values[f.key];
          const err = errors[f.key];
          return (
            <div key={f.key} className="space-y-1">
              <label htmlFor={`f-${f.key}`} className="block text-sm font-medium text-fg">
                {f.label}
              </label>
              {f.description ? (
                <p className="text-xs text-fg-muted">{f.description}</p>
              ) : null}
              {f.kind === 'boolean' ? (
                <select
                  id={`f-${f.key}`}
                  className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
                  value={display(current, f.kind)}
                  onChange={(e) => setValues({ ...values, [f.key]: coerce(f.kind, e.target.value) })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : f.kind === 'textarea' ? (
                <textarea
                  id={`f-${f.key}`}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
                  rows={3}
                  value={display(current, f.kind)}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues({ ...values, [f.key]: coerce(f.kind, e.target.value) })}
                />
              ) : f.kind === 'color' ? (
                <input
                  id={`f-${f.key}`}
                  type="color"
                  className="h-8 w-16 rounded border border-border bg-bg"
                  value={display(current, f.kind) || '#000000'}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              ) : f.kind === 'enum-list' ? (
                <EnumListEditor
                  value={Array.isArray(current) ? (current as string[]) : []}
                  onChange={(next) => setValues({ ...values, [f.key]: next })}
                />
              ) : (
                <input
                  id={`f-${f.key}`}
                  type={f.kind === 'number' || f.kind === 'cents' ? 'number' : 'text'}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
                  value={display(current, f.kind)}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues({ ...values, [f.key]: coerce(f.kind, e.target.value) })}
                />
              )}
              {err ? <p className="text-xs text-rose-600">{err}</p> : null}
            </div>
          );
        })}
      </div>

      {children}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          className="rounded-md bg-fg px-3 py-1.5 text-sm text-bg disabled:opacity-50"
          disabled={!dirty || mutation.isPending}
          onClick={onSave}
        >
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => {
            setValues({ ...initialValues });
            setErrors({});
          }}
        >
          Reset
        </button>
        {dirty ? <span className="text-xs text-fg-muted">Unsaved changes</span> : null}
      </div>
    </div>
  );
}
