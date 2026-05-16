/**
 * Expense category selector. Categories are typically a small set, so we
 * fetch the full active list once.
 */
import { useQuery } from '@tanstack/react-query';

import { expenseCategoryKeys } from '@/lib/queryKeys/expenseCategories';
import { listExpenseCategories } from '@/lib/services/expenseCategoriesService';

interface Props {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  id?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  'data-testid'?: string;
}

export function ExpenseCategoryPicker({
  value,
  onChange,
  id,
  disabled,
  allowEmpty = true,
  ...rest
}: Props) {
  const query = useQuery({
    queryKey: expenseCategoryKeys.list({ is_active: true }),
    queryFn: () => listExpenseCategories({ is_active: true }),
    staleTime: 60_000,
  });
  const cats = query.data?.items ?? [];

  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      data-testid={rest['data-testid'] ?? 'expense-category-picker'}
      className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
    >
      {allowEmpty && <option value="">(uncategorized)</option>}
      {cats.map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.label}
        </option>
      ))}
    </select>
  );
}
