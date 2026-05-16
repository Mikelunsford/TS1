/**
 * AccountFormPage — Wave 8 / Phase 12. Create or edit a chart-of-accounts
 * row. All inputs are disabled when `is_system=true` (constitutional
 * invariant). Validation runs Zod-at-submit via
 * ChartOfAccountCreateSchema / PatchSchema.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { chartOfAccountKeys } from '@/lib/queryKeys/chartOfAccounts';
import {
  createChartOfAccount,
  getChartOfAccount,
  updateChartOfAccount,
} from '@/lib/services/chartOfAccountsService';
import {
  ChartOfAccountCreateSchema,
  ChartOfAccountPatchSchema,
  ChartOfAccountTypeSchema,
  type ChartOfAccountCreate,
  type ChartOfAccountPatch,
  type ChartOfAccountType,
} from '@/lib/types';

interface FormState {
  account_code: string;
  label: string;
  account_type: ChartOfAccountType;
  currency_code: string;
  description: string;
  is_active: boolean;
}

function emptyForm(): FormState {
  return {
    account_code: '',
    label: '',
    account_type: 'asset',
    currency_code: '',
    description: '',
    is_active: true,
  };
}

export default function AccountFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id) && id !== 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm());

  const existing = useQuery({
    queryKey: id ? chartOfAccountKeys.detail(id) : ['chart-of-accounts', 'new'],
    queryFn: () => getChartOfAccount(id!),
    enabled: isEdit,
  });

  useEffect(() => {
    if (isEdit && existing.data) {
      setForm({
        account_code: existing.data.account_code,
        label: existing.data.label,
        account_type: existing.data.account_type,
        currency_code: existing.data.currency_code ?? '',
        description: existing.data.description ?? '',
        is_active: existing.data.is_active,
      });
    }
  }, [isEdit, existing.data]);

  const createMutation = useMutation({
    mutationFn: (body: ChartOfAccountCreate) => createChartOfAccount(body),
    onSuccess: (data) => {
      toast.success(`Account ${data.account_code} created`);
      void qc.invalidateQueries({ queryKey: chartOfAccountKeys.all });
      navigate(`/finance/accounts/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: ChartOfAccountPatch) => updateChartOfAccount(id!, body),
    onSuccess: (data) => {
      toast.success('Account updated');
      void qc.invalidateQueries({ queryKey: chartOfAccountKeys.detail(data.id) });
      void qc.invalidateQueries({ queryKey: chartOfAccountKeys.all });
      navigate(`/finance/accounts/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  const isSystem = existing.data?.is_system === true;
  const submitting = createMutation.isPending || patchMutation.isPending;

  function buildCreatePayload(): ChartOfAccountCreate {
    const body: ChartOfAccountCreate = {
      account_code: form.account_code.trim(),
      label: form.label.trim(),
      account_type: form.account_type,
      is_active: form.is_active,
    };
    if (form.currency_code.trim()) body.currency_code = form.currency_code.trim().toUpperCase();
    if (form.description.trim()) body.description = form.description.trim();
    return body;
  }

  function buildPatchPayload(): ChartOfAccountPatch {
    const body: ChartOfAccountPatch = {
      account_code: form.account_code.trim(),
      label: form.label.trim(),
      account_type: form.account_type,
      is_active: form.is_active,
      currency_code: form.currency_code.trim() ? form.currency_code.trim().toUpperCase() : null,
      description: form.description.trim() ? form.description.trim() : null,
    };
    return body;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSystem) {
      toast.error('System accounts cannot be edited');
      return;
    }
    try {
      if (isEdit) {
        const body = ChartOfAccountPatchSchema.parse(buildPatchPayload());
        patchMutation.mutate(body);
      } else {
        const body = ChartOfAccountCreateSchema.parse(buildCreatePayload());
        createMutation.mutate(body);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation failed');
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/finance/accounts" className="hover:underline">
          Chart of accounts
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">
          {isEdit ? existing.data?.account_code ?? '…' : 'New'}
        </span>
      </nav>

      <h1 className="text-2xl font-semibold">
        {isEdit ? 'Edit account' : 'New account'}
      </h1>

      {existing.isLoading && <Skeleton className="h-64 w-full" />}
      {existing.error && <ErrorState title="Could not load account" error={existing.error} />}

      {(!isEdit || existing.data) && (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-md border border-border bg-bg p-4"
          aria-disabled={isSystem}
          data-testid="account-form"
        >
          {isSystem && (
            <p
              className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning"
              data-testid="system-account-notice"
            >
              This is a system-seeded account. All fields are read-only.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Code</span>
              <input
                type="text"
                required
                maxLength={64}
                value={form.account_code}
                onChange={(e) => setForm({ ...form, account_code: e.target.value })}
                disabled={isSystem}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                data-testid="account-code-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Label</span>
              <input
                type="text"
                required
                maxLength={255}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                disabled={isSystem}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                data-testid="account-label-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Type</span>
              <select
                value={form.account_type}
                onChange={(e) =>
                  setForm({ ...form, account_type: e.target.value as ChartOfAccountType })
                }
                disabled={isSystem}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                data-testid="account-type-select"
              >
                {ChartOfAccountTypeSchema.options.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">
                Currency (optional)
              </span>
              <input
                type="text"
                maxLength={3}
                placeholder="USD"
                value={form.currency_code}
                onChange={(e) =>
                  setForm({ ...form, currency_code: e.target.value.toUpperCase() })
                }
                disabled={isSystem}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm font-mono uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={isSystem}
                rows={2}
                maxLength={4000}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
              />
            </label>
            {isEdit && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  disabled={isSystem}
                />
                <span>Active</span>
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Link
              to={isEdit && id ? `/finance/accounts/${id}` : '/finance/accounts'}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || isSystem}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="account-submit"
            >
              {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
