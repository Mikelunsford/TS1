/**
 * WarehouseFormPage — Create or edit a warehouse. Bare useState +
 * Zod safeParse pattern (R-01).
 *
 * Wave 8f / Phase 13. is_default semantics: at most one default per org.
 * BE handler unsets prior default if this one is being flagged default.
 * Archive (soft-delete) is exposed on the edit form; refused for the
 * current default warehouse by the BE (STATE_CONFLICT 409).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { warehouseKeys } from '@/lib/queryKeys/warehouses';
import {
  archiveWarehouse,
  createWarehouse,
  getWarehouse,
  updateWarehouse,
} from '@/lib/services/warehousesService';
import {
  WarehouseCreateSchema,
  WarehousePatchSchema,
  type Warehouse,
  type WarehouseCreate,
  type WarehousePatch,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof WarehouseCreate, string[] | undefined>>;

interface FormState {
  code: string;
  label: string;
  address_line1: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  is_active: boolean;
}

function emptyForm(): FormState {
  return {
    code: '',
    label: '',
    address_line1: '',
    city: '',
    region: '',
    postal_code: '',
    country: '',
    is_default: false,
    is_active: true,
  };
}

function fromWarehouse(w: Warehouse): FormState {
  const a = (w.address ?? {}) as Record<string, unknown>;
  return {
    code: w.code,
    label: w.label,
    address_line1: typeof a.line1 === 'string' ? a.line1 : '',
    city: typeof a.city === 'string' ? a.city : '',
    region: typeof a.region === 'string' ? a.region : '',
    postal_code: typeof a.postal_code === 'string' ? a.postal_code : '',
    country: typeof a.country === 'string' ? a.country : '',
    is_default: w.is_default,
    is_active: w.is_active,
  };
}

function buildAddress(form: FormState): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  if (form.address_line1.trim()) a.line1 = form.address_line1.trim();
  if (form.city.trim()) a.city = form.city.trim();
  if (form.region.trim()) a.region = form.region.trim();
  if (form.postal_code.trim()) a.postal_code = form.postal_code.trim();
  if (form.country.trim()) a.country = form.country.trim();
  return a;
}

export default function WarehouseFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: id ? warehouseKeys.detail(id) : ['warehouse', 'new'],
    queryFn: () => getWarehouse(id!),
    enabled: isEdit,
  });

  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) setForm(fromWarehouse(existing.data));
  }, [existing.data]);

  const createMutation = useMutation({
    mutationFn: (body: WarehouseCreate) => createWarehouse(body),
    onSuccess: (data) => {
      toast.success(`Warehouse ${data.label} created`);
      void qc.invalidateQueries({ queryKey: warehouseKeys.all });
      navigate('/warehouses');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: WarehousePatch) => updateWarehouse(id!, body),
    onSuccess: (data) => {
      toast.success('Warehouse updated');
      void qc.invalidateQueries({ queryKey: warehouseKeys.detail(data.id) });
      void qc.invalidateQueries({ queryKey: warehouseKeys.all });
      navigate('/warehouses');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveWarehouse(id!),
    onSuccess: () => {
      toast.success('Warehouse archived');
      void qc.invalidateQueries({ queryKey: warehouseKeys.all });
      navigate('/warehouses');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Archive failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const address = buildAddress(form);
    const candidate: Record<string, unknown> = {
      code: form.code,
      label: form.label,
      address,
      is_default: form.is_default,
    };
    if (isEdit) candidate.is_active = form.is_active;

    const schema = isEdit ? WarehousePatchSchema : WarehouseCreateSchema;
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      setTopError('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    if (isEdit) {
      patchMutation.mutate(parsed.data as WarehousePatch);
    } else {
      createMutation.mutate(parsed.data as WarehouseCreate);
    }
  }

  const submitting = createMutation.isPending || patchMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/warehouses" className="hover:underline">Warehouses</Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{isEdit ? form.label || '…' : 'New'}</span>
      </nav>

      <h1 className="text-2xl font-semibold">{isEdit ? 'Edit warehouse' : 'New warehouse'}</h1>

      {existing.isLoading && <Skeleton className="h-64 w-full" />}
      {existing.error && <ErrorState title="Could not load warehouse" error={existing.error} />}

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" error={errors.code} required>
            <input
              type="text"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              maxLength={64}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="warehouse-code"
            />
          </Field>
          <Field label="Label" error={errors.label} required>
            <input
              type="text"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="warehouse-label"
            />
          </Field>
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs uppercase tracking-wide text-fg-subtle">Address</legend>
          <Field label="Street">
            <input
              type="text"
              value={form.address_line1}
              onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="City">
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
            <Field label="Region">
              <input
                type="text"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
            <Field label="Postal">
              <input
                type="text"
                value={form.postal_code}
                onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
            <Field label="Country">
              <input
                type="text"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          />
          Default warehouse (at most one per organization)
        </label>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Active
          </label>
        )}

        {topError && (
          <p role="alert" className="text-sm text-danger">
            {topError}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {isEdit && form.is_active && !form.is_default && (
            <button
              type="button"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
              data-testid="warehouse-archive"
            >
              {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
            </button>
          )}
          <Link
            to="/warehouses"
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="warehouse-submit"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create warehouse'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string[] | undefined;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error && error.length > 0 && (
        <span className="text-xs text-danger">{error.join(', ')}</span>
      )}
    </label>
  );
}
