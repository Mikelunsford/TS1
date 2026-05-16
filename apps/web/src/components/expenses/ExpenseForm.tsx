/**
 * ExpenseForm — single-line expense form. `total_cents = amount + tax` is
 * computed by the BIU trigger added in migration 0058; SPA shows a preview
 * but does NOT send `total_cents` (it's not in ExpenseCreateSchema).
 *
 * Plain useState + Zod-at-submit (react-hook-form banned).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { ExpenseCategoryPicker } from '@/components/expenses/ExpenseCategoryPicker';
import { ReceiptUploader } from '@/components/expenses/ReceiptUploader';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ExpenseCreateSchema, type Expense, type ExpenseCreate } from '@/lib/types';

type FieldErrors = Partial<Record<keyof ExpenseCreate, string[] | undefined>>;

export interface ExpenseFormState {
  category_id: string;
  vendor_id: string;
  project_id: string;
  spent_at: string;
  description: string;
  currency_code: string;
  amount_cents: number;
  tax_cents: number;
  receipt_url: string;
  notes: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyExpenseForm(): ExpenseFormState {
  return {
    category_id: '',
    vendor_id: '',
    project_id: '',
    spent_at: todayIso(),
    description: '',
    currency_code: 'USD',
    amount_cents: 0,
    tax_cents: 0,
    receipt_url: '',
    notes: '',
  };
}

export function fromExpense(e: Expense): ExpenseFormState {
  return {
    category_id: e.category_id ?? '',
    vendor_id: e.vendor_id ?? '',
    project_id: e.project_id ?? '',
    spent_at: e.spent_at,
    description: e.description ?? '',
    currency_code: e.currency_code,
    amount_cents: Number(e.amount_cents),
    tax_cents: Number(e.tax_cents),
    receipt_url: e.receipt_url ?? '',
    notes: e.notes ?? '',
  };
}

interface Props {
  initial?: ExpenseFormState;
  submitting?: boolean;
  onSubmit: (parsed: ExpenseCreate) => void;
  submitLabel?: string;
  cancelHref?: string;
}

export function ExpenseForm({
  initial,
  submitting,
  onSubmit,
  submitLabel = 'Save expense',
  cancelHref,
}: Props) {
  const [form, setForm] = useState<ExpenseFormState>(initial ?? emptyExpenseForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  const totalPreview = useMemo(
    () => Number(form.amount_cents) + Number(form.tax_cents),
    [form.amount_cents, form.tax_cents],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const candidate: ExpenseCreate = {
      category_id: form.category_id || null,
      vendor_id: form.vendor_id.trim() === '' ? null : form.vendor_id,
      project_id: form.project_id.trim() === '' ? null : form.project_id,
      spent_at: form.spent_at || undefined,
      description: form.description.trim() === '' ? null : form.description,
      currency_code: form.currency_code,
      amount_cents: form.amount_cents,
      tax_cents: form.tax_cents,
      receipt_url: form.receipt_url.trim() === '' ? null : form.receipt_url,
      notes: form.notes.trim() === '' ? null : form.notes,
    };

    const parsed = ExpenseCreateSchema.safeParse(candidate);
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" error={errors.spent_at} required>
          <input
            type="date"
            value={form.spent_at}
            onChange={(e) => setForm({ ...form, spent_at: e.target.value })}
            required
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="exp-spent-at"
          />
        </Field>

        <Field label="Category" error={errors.category_id}>
          <ExpenseCategoryPicker
            value={form.category_id || null}
            onChange={(id) => setForm({ ...form, category_id: id ?? '' })}
          />
        </Field>

        <Field label="Vendor ID (optional)" error={errors.vendor_id}>
          <input
            type="text"
            value={form.vendor_id}
            onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
            placeholder="(UUID)"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Project ID (optional)" error={errors.project_id}>
          <input
            type="text"
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            placeholder="(UUID)"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
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

      <Field label="Description" error={errors.description}>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What was this for?"
          className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>

      <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
        <Field label="Amount" error={errors.amount_cents} required>
          <MoneyInput
            value={form.amount_cents}
            onChange={(c) => setForm({ ...form, amount_cents: c })}
            currency={form.currency_code}
            aria-label="Amount"
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
        <div>
          <span className="block text-xs uppercase tracking-wide text-fg-subtle">Total preview</span>
          <span
            className="mt-1 inline-block font-mono text-fg"
            data-testid="exp-total-preview"
          >
            {totalPreview} cents
          </span>
        </div>
      </div>

      <Field label="Receipt URL" error={errors.receipt_url}>
        <ReceiptUploader
          value={form.receipt_url}
          onChange={(u) => setForm({ ...form, receipt_url: u })}
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
          data-testid="exp-submit"
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
