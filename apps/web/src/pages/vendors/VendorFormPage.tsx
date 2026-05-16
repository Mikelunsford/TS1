/**
 * VendorFormPage — Create or edit a vendor. Bare useState +
 * VendorCreateSchema/VendorPatchSchema safeParse at submit (R-01 forms
 * reconcile; no react-hook-form).
 *
 * `name` (NOT display_name) per the Wave 7 invariant — vendors did NOT
 * get the F-Wave6-03 customers rename.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { vendorKeys } from '@/lib/queryKeys/vendors';
import {
  createVendor,
  getVendor,
  updateVendor,
} from '@/lib/services/vendorsService';
import {
  VendorCreateSchema,
  VendorPatchSchema,
  type Vendor,
  type VendorCreate,
  type VendorPatch,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof VendorCreate, string[] | undefined>>;

interface FormState {
  name: string;
  legal_name: string;
  email: string;
  phone: string;
  website: string;
  tax_id: string;
  currency_code: string;
  payment_terms_days: string;
  external_ref: string;
  notes: string;
  is_active: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    legal_name: '',
    email: '',
    phone: '',
    website: '',
    tax_id: '',
    currency_code: 'USD',
    payment_terms_days: '30',
    external_ref: '',
    notes: '',
    is_active: true,
  };
}

function fromVendor(v: Vendor): FormState {
  return {
    name: v.name,
    legal_name: v.legal_name ?? '',
    email: v.email ?? '',
    phone: v.phone ?? '',
    website: v.website ?? '',
    tax_id: v.tax_id ?? '',
    currency_code: v.currency_code ?? 'USD',
    payment_terms_days: String(v.payment_terms_days),
    external_ref: v.external_ref ?? '',
    notes: v.notes ?? '',
    is_active: v.is_active,
  };
}

export default function VendorFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: id ? vendorKeys.detail(id) : ['vendor', 'new'],
    queryFn: () => getVendor(id!),
    enabled: isEdit,
  });

  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) setForm(fromVendor(existing.data));
  }, [existing.data]);

  const createMutation = useMutation({
    mutationFn: (body: VendorCreate) => createVendor(body),
    onSuccess: (data) => {
      toast.success(`Vendor ${data.name} created`);
      void qc.invalidateQueries({ queryKey: vendorKeys.all });
      navigate(`/vendors/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: VendorPatch) => updateVendor(id!, body),
    onSuccess: (data) => {
      toast.success('Vendor updated');
      void qc.invalidateQueries({ queryKey: vendorKeys.detail(data.id) });
      void qc.invalidateQueries({ queryKey: vendorKeys.all });
      navigate(`/vendors/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const candidate: Record<string, unknown> = {
      name: form.name,
      legal_name: form.legal_name.trim() === '' ? null : form.legal_name,
      email: form.email.trim() === '' ? null : form.email,
      phone: form.phone.trim() === '' ? null : form.phone,
      website: form.website.trim() === '' ? null : form.website,
      tax_id: form.tax_id.trim() === '' ? null : form.tax_id,
      currency_code: form.currency_code.trim() === '' ? null : form.currency_code,
      payment_terms_days: Number(form.payment_terms_days) || 0,
      external_ref: form.external_ref.trim() === '' ? null : form.external_ref,
      notes: form.notes.trim() === '' ? null : form.notes,
    };
    if (isEdit) candidate.is_active = form.is_active;

    const schema = isEdit ? VendorPatchSchema : VendorCreateSchema;
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      setTopError('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    if (isEdit) {
      patchMutation.mutate(parsed.data as VendorPatch);
    } else {
      createMutation.mutate(parsed.data as VendorCreate);
    }
  }

  const submitting = createMutation.isPending || patchMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/vendors" className="hover:underline">
          Vendors
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{isEdit ? form.name || '…' : 'New'}</span>
      </nav>

      <h1 className="text-2xl font-semibold">{isEdit ? 'Edit vendor' : 'New vendor'}</h1>

      {existing.isLoading && <Skeleton className="h-64 w-full" />}
      {existing.error && <ErrorState title="Could not load vendor" error={existing.error} />}

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <Field label="Name" error={errors.name} required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="vendor-name"
          />
        </Field>

        <Field label="Legal name" error={errors.legal_name}>
          <input
            type="text"
            value={form.legal_name}
            onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" error={errors.email}>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Website" error={errors.website}>
            <input
              type="url"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Tax ID" error={errors.tax_id}>
            <input
              type="text"
              value={form.tax_id}
              onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Currency" error={errors.currency_code}>
            <input
              type="text"
              maxLength={3}
              value={form.currency_code}
              onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
              className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Payment terms (days)" error={errors.payment_terms_days}>
            <input
              type="number"
              min={0}
              value={form.payment_terms_days}
              onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
              className="w-32 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
        </div>

        <Field label="External ref" error={errors.external_ref}>
          <input
            type="text"
            value={form.external_ref}
            onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Notes" error={errors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

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

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to={isEdit ? `/vendors/${id}` : '/vendors'}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="vendor-submit"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create vendor'}
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
