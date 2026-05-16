/**
 * PurchaseOrderFormPage — Create (header-only) or edit a draft PO. Line
 * items are added on the detail page via `<POLineEditor>` after the PO
 * exists. Bare useState + Zod safeParse at submit.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { VendorPicker } from '@/components/procurement/VendorPicker';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { purchaseOrderKeys } from '@/lib/queryKeys/purchaseOrders';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  updatePurchaseOrder,
} from '@/lib/services/purchaseOrdersService';
import {
  PurchaseOrderCreateSchema,
  PurchaseOrderPatchSchema,
  type PurchaseOrderCreate,
  type PurchaseOrderPatch,
} from '@/lib/types';

interface FormState {
  vendor_id: string;
  project_id: string;
  issue_date: string;
  expected_date: string;
  currency_code: string;
  tax_cents: number;
  shipping_cents: number;
  notes: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    vendor_id: '',
    project_id: '',
    issue_date: todayIso(),
    expected_date: '',
    currency_code: 'USD',
    tax_cents: 0,
    shipping_cents: 0,
    notes: '',
  };
}

export default function PurchaseOrderFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: id ? purchaseOrderKeys.detail(id) : ['po', 'new'],
    queryFn: () => getPurchaseOrder(id!),
    enabled: isEdit,
  });

  const [form, setForm] = useState<FormState>(emptyForm());
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setForm({
      vendor_id: d.vendor_id,
      project_id: d.project_id ?? '',
      issue_date: d.issue_date,
      expected_date: d.expected_date ?? '',
      currency_code: d.currency_code,
      tax_cents: Number(d.tax_cents),
      shipping_cents: Number(d.shipping_cents),
      notes: d.notes ?? '',
    });
  }, [existing.data]);

  const createMutation = useMutation({
    mutationFn: (body: PurchaseOrderCreate) => createPurchaseOrder(body),
    onSuccess: (data) => {
      toast.success(`PO ${data.po_number} created`);
      void qc.invalidateQueries({ queryKey: purchaseOrderKeys.all });
      navigate(`/purchase-orders/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: PurchaseOrderPatch) => updatePurchaseOrder(id!, body),
    onSuccess: (data) => {
      toast.success('PO updated');
      void qc.invalidateQueries({ queryKey: purchaseOrderKeys.detail(data.id) });
      navigate(`/purchase-orders/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    if (!isEdit) {
      const candidate: PurchaseOrderCreate = {
        vendor_id: form.vendor_id,
        project_id: form.project_id.trim() === '' ? null : form.project_id,
        issue_date: form.issue_date || undefined,
        expected_date: form.expected_date || null,
        currency_code: form.currency_code,
        tax_cents: form.tax_cents,
        shipping_cents: form.shipping_cents,
        notes: form.notes.trim() === '' ? null : form.notes,
      };
      const parsed = PurchaseOrderCreateSchema.safeParse(candidate);
      if (!parsed.success) {
        setTopError('Please fix the highlighted fields.');
        toast.error('Validation failed: ' + parsed.error.issues[0]?.message);
        return;
      }
      createMutation.mutate(parsed.data);
      return;
    }

    const patch: PurchaseOrderPatch = {
      project_id: form.project_id.trim() === '' ? null : form.project_id,
      issue_date: form.issue_date || undefined,
      expected_date: form.expected_date || null,
      currency_code: form.currency_code,
      tax_cents: form.tax_cents,
      shipping_cents: form.shipping_cents,
      notes: form.notes.trim() === '' ? null : form.notes,
    };
    const parsed = PurchaseOrderPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setTopError('Please fix the highlighted fields.');
      return;
    }
    patchMutation.mutate(parsed.data);
  }

  const submitting = createMutation.isPending || patchMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/purchase-orders" className="hover:underline">
          Purchase orders
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{isEdit ? existing.data?.po_number ?? '…' : 'New'}</span>
      </nav>

      <h1 className="text-2xl font-semibold">{isEdit ? 'Edit PO' : 'New purchase order'}</h1>

      {existing.isLoading && <Skeleton className="h-48 w-full" />}
      {existing.error && <ErrorState title="Could not load PO" error={existing.error} />}

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        {!isEdit && (
          <Field label="Vendor" required>
            <VendorPicker
              value={form.vendor_id}
              onChange={(id) => setForm({ ...form, vendor_id: id })}
            />
          </Field>
        )}

        <Field label="Project ID (optional)">
          <input
            type="text"
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            placeholder="(UUID)"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issue date">
            <input
              type="date"
              value={form.issue_date}
              onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Expected date">
            <input
              type="date"
              value={form.expected_date}
              onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Currency">
            <input
              type="text"
              maxLength={3}
              value={form.currency_code}
              onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
              className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax">
            <MoneyInput
              value={form.tax_cents}
              onChange={(c) => setForm({ ...form, tax_cents: c })}
              currency={form.currency_code}
              aria-label="Tax"
            />
          </Field>
          <Field label="Shipping">
            <MoneyInput
              value={form.shipping_cents}
              onChange={(c) => setForm({ ...form, shipping_cents: c })}
              currency={form.currency_code}
              aria-label="Shipping"
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        {topError && (
          <p role="alert" className="text-sm text-danger">
            {topError}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to={isEdit ? `/purchase-orders/${id}` : '/purchase-orders'}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="po-submit"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create PO'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
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
    </label>
  );
}
