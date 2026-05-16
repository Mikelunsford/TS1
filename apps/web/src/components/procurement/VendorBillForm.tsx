/**
 * VendorBillForm — header-only form used by Create + Edit pages. Vendor
 * bills have no line items in prod (D-W7-6); user enters subtotal, tax,
 * and total directly. SPA shows a live preview of `subtotal + tax`; BE
 * trusts the submitted `total_cents` (handler validates).
 *
 * Plain useState + Zod-at-submit (react-hook-form banned).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/ui/MoneyInput';
import {
  VendorBillCreateSchema,
  type VendorBillCreate,
  type VendorBill,
} from '@/lib/types';

import { VendorPicker } from './VendorPicker';

type FieldErrors = Partial<Record<keyof VendorBillCreate, string[] | undefined>>;

export interface VendorBillFormState {
  vendor_id: string;
  po_id: string;
  vendor_ref: string;
  issue_date: string;
  due_date: string;
  currency_code: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyVendorBillForm(): VendorBillFormState {
  return {
    vendor_id: '',
    po_id: '',
    vendor_ref: '',
    issue_date: todayIso(),
    due_date: '',
    currency_code: 'USD',
    subtotal_cents: 0,
    tax_cents: 0,
    total_cents: 0,
    notes: '',
  };
}

export function fromVendorBill(b: VendorBill): VendorBillFormState {
  return {
    vendor_id: b.vendor_id,
    po_id: b.po_id ?? '',
    vendor_ref: b.vendor_ref ?? '',
    issue_date: b.issue_date,
    due_date: b.due_date,
    currency_code: b.currency_code,
    subtotal_cents: Number(b.subtotal_cents),
    tax_cents: Number(b.tax_cents),
    total_cents: Number(b.total_cents),
    notes: b.notes ?? '',
  };
}

interface Props {
  initial?: VendorBillFormState;
  submitting?: boolean;
  onSubmit: (parsed: VendorBillCreate) => void;
  submitLabel?: string;
  cancelHref?: string;
}

export function VendorBillForm({
  initial,
  submitting,
  onSubmit,
  submitLabel = 'Save vendor bill',
  cancelHref,
}: Props) {
  const [form, setForm] = useState<VendorBillFormState>(initial ?? emptyVendorBillForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  const totalPreview = useMemo(
    () => Number(form.subtotal_cents) + Number(form.tax_cents),
    [form.subtotal_cents, form.tax_cents],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const candidate: VendorBillCreate = {
      vendor_id: form.vendor_id,
      po_id: form.po_id.trim() === '' ? null : form.po_id,
      vendor_ref: form.vendor_ref.trim() === '' ? null : form.vendor_ref,
      issue_date: form.issue_date || undefined,
      due_date: form.due_date,
      currency_code: form.currency_code,
      subtotal_cents: form.subtotal_cents,
      tax_cents: form.tax_cents,
      total_cents: form.total_cents || totalPreview,
      notes: form.notes.trim() === '' ? null : form.notes,
    };

    const parsed = VendorBillCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      setTopError('Please fix the highlighted fields.');
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
      <Field label="Vendor" error={errors.vendor_id} required>
        <VendorPicker
          value={form.vendor_id}
          onChange={(id) => setForm({ ...form, vendor_id: id })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor reference" error={errors.vendor_ref}>
          <input
            type="text"
            value={form.vendor_ref}
            onChange={(e) => setForm({ ...form, vendor_ref: e.target.value })}
            placeholder="Vendor's invoice #"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="PO ID (optional)" error={errors.po_id}>
          <input
            type="text"
            value={form.po_id}
            onChange={(e) => setForm({ ...form, po_id: e.target.value })}
            placeholder="(UUID)"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Issue date" error={errors.issue_date}>
          <input
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Due date" error={errors.due_date} required>
          <input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            required
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="vb-due-date"
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
      </div>

      <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
        <Field label="Subtotal" error={errors.subtotal_cents} required>
          <MoneyInput
            value={form.subtotal_cents}
            onChange={(c) => setForm({ ...form, subtotal_cents: c })}
            currency={form.currency_code}
            aria-label="Subtotal"
          />
        </Field>
        <Field label="Tax" error={errors.tax_cents}>
          <MoneyInput
            value={form.tax_cents}
            onChange={(c) => setForm({ ...form, tax_cents: c })}
            currency={form.currency_code}
            aria-label="Tax"
          />
        </Field>
        <Field label="Total" error={errors.total_cents} required>
          <MoneyInput
            value={form.total_cents || totalPreview}
            onChange={(c) => setForm({ ...form, total_cents: c })}
            currency={form.currency_code}
            aria-label="Total"
          />
        </Field>
      </div>

      <p className="text-xs text-fg-subtle" data-testid="vb-total-preview">
        Subtotal + tax = {totalPreview} cents. Leave Total at this value or override if the
        vendor's invoice differs.
      </p>

      <Field label="Notes" error={errors.notes}>
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
        {cancelHref && (
          <a
            href={cancelHref}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </a>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          data-testid="vb-submit"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
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
      {error && error.length > 0 && <span className="text-xs text-danger">{error.join(', ')}</span>}
    </label>
  );
}
