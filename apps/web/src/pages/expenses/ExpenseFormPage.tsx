/**
 * ExpenseFormPage — Create or edit a draft / rejected expense. Single
 * line; total is server-computed. Delegates to <ExpenseForm>.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ExpenseForm } from '@/components/expenses/ExpenseForm';
import {
  emptyExpenseForm,
  fromExpense,
} from '@/components/expenses/expenseFormHelpers';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { expenseKeys } from '@/lib/queryKeys/expenses';
import {
  createExpense,
  getExpense,
  updateExpense,
} from '@/lib/services/expensesService';
import type { ExpenseCreate, ExpensePatch } from '@/lib/types';

export default function ExpenseFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: id ? expenseKeys.detail(id) : ['expense', 'new'],
    queryFn: () => getExpense(id!),
    enabled: isEdit,
  });

  const createMutation = useMutation({
    mutationFn: (body: ExpenseCreate) => createExpense(body),
    onSuccess: (data) => {
      toast.success(`Expense ${data.expense_number} created`);
      void qc.invalidateQueries({ queryKey: expenseKeys.all });
      navigate(`/expenses/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: ExpensePatch) => updateExpense(id!, body),
    onSuccess: (data) => {
      toast.success('Expense updated');
      void qc.invalidateQueries({ queryKey: expenseKeys.detail(data.id) });
      void qc.invalidateQueries({ queryKey: expenseKeys.all });
      navigate(`/expenses/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  function onSubmit(parsed: ExpenseCreate) {
    if (isEdit) {
      patchMutation.mutate(parsed as ExpensePatch);
    } else {
      createMutation.mutate(parsed);
    }
  }

  const submitting = createMutation.isPending || patchMutation.isPending;
  const initial =
    isEdit && existing.data ? fromExpense(existing.data) : emptyExpenseForm();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/expenses" className="hover:underline">
          Expenses
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{isEdit ? existing.data?.expense_number ?? '…' : 'New'}</span>
      </nav>

      <h1 className="text-2xl font-semibold">{isEdit ? 'Edit expense' : 'New expense'}</h1>

      {existing.isLoading && <Skeleton className="h-64 w-full" />}
      {existing.error && <ErrorState title="Could not load expense" error={existing.error} />}

      {(!isEdit || existing.data) && (
        <ExpenseForm
          initial={initial}
          submitting={submitting}
          onSubmit={onSubmit}
          submitLabel={isEdit ? 'Save' : 'Create expense'}
          cancelHref={isEdit ? `/expenses/${id}` : '/expenses'}
        />
      )}
    </div>
  );
}
