/**
 * Helper module for JournalEntryEditor — kept separate from the component
 * file so `react-refresh/only-export-components` stays happy.
 */

export interface JEEditorLine {
  account_id: string;
  debit_cents: number;
  credit_cents: number;
  memo: string;
}

export function emptyJELine(): JEEditorLine {
  return { account_id: '', debit_cents: 0, credit_cents: 0, memo: '' };
}
