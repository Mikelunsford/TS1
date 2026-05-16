/**
 * MyExpensesPage — same list, scoped to the calling user via `me=true`.
 */
import ExpenseListPage from './ExpenseListPage';

export default function MyExpensesPage() {
  return (
    <ExpenseListPage
      scopedToMe
      title="My expenses"
      description="Expenses you've submitted."
    />
  );
}
