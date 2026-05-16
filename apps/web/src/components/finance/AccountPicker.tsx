/**
 * AccountPicker — searchable select bound to `GET /chart-of-accounts?is_active=true`.
 * Pattern mirrors `InvoicePicker` / `ExpenseCategoryPicker`. Renders
 * `${account_code} — ${label}` options. Returns the selected account_id (or
 * empty string for none).
 */
import { useQuery } from '@tanstack/react-query';

import { chartOfAccountKeys } from '@/lib/queryKeys/chartOfAccounts';
import { listChartOfAccounts } from '@/lib/services/chartOfAccountsService';
import type { ChartOfAccountType } from '@/lib/types';

export interface AccountPickerProps {
  value: string;
  onChange: (accountId: string) => void;
  /** Restrict to one account type when set. */
  accountType?: ChartOfAccountType;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  'data-testid'?: string;
  'aria-label'?: string;
}

export function AccountPicker({
  value,
  onChange,
  accountType,
  id,
  disabled,
  required,
  placeholder = 'Select an account…',
  'data-testid': testId,
  'aria-label': ariaLabel,
}: AccountPickerProps) {
  const filters = { is_active: true, ...(accountType ? { account_type: accountType } : {}) };
  const query = useQuery({
    queryKey: chartOfAccountKeys.list(filters),
    queryFn: () => listChartOfAccounts(filters),
    staleTime: 60_000,
  });

  const items = query.data?.items ?? [];

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
      data-testid={testId}
    >
      <option value="">{placeholder}</option>
      {items.map((acc) => (
        <option key={acc.id} value={acc.id}>
          {acc.account_code} — {acc.label}
        </option>
      ))}
    </select>
  );
}
