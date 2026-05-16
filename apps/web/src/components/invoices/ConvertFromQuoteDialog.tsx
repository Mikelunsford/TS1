/**
 * ConvertFromQuoteDialog — modal that picks an `approved` quote and a
 * due date, then POSTs `/invoicing-api/invoices/from-quote`. Reuses the
 * hand-rolled modal pattern from `components/quotes/QuoteActionDialog.tsx`
 * (no Radix).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { quoteKeys } from '@/lib/queryKeys/quotes';
import { convertFromQuote } from '@/lib/services/invoicesService';
import { listQuotes } from '@/lib/services/quotesService';
import {
  InvoiceConvertFromQuoteSchema,
  type InvoiceConvertFromQuote,
} from '@/lib/types';

export interface ConvertFromQuoteDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ConvertFromQuoteDialog({ open, onClose }: ConvertFromQuoteDialogProps) {
  const navigate = useNavigate();
  const [quoteId, setQuoteId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuoteId('');
      setDueDate('');
      setSearch('');
      setError(null);
    }
  }, [open]);

  // Only `approved` quotes can convert per the workflow matrix.
  const quotesQuery = useQuery({
    queryKey: [...quoteKeys.list({ status: 'approved' }), { q: search }],
    queryFn: () => listQuotes(search ? { q: search, status: 'approved' } : { status: 'approved' }),
    staleTime: 30_000,
    enabled: open,
  });

  const quotes = quotesQuery.data?.items ?? [];

  const mutation = useMutation({
    mutationFn: (body: InvoiceConvertFromQuote) => convertFromQuote(body),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoice_number} created from quote`);
      onClose();
      navigate(`/invoices/${inv.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Convert failed'),
  });

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate = { quote_id: quoteId, due_date: dueDate };
    const parsed = InvoiceConvertFromQuoteSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid payload');
      return;
    }
    setError(null);
    mutation.mutate(parsed.data);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="convert-from-quote-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="convert-from-quote-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-fg/40"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-bg p-6 shadow-lg">
        <h2 id="convert-from-quote-title" className="text-lg font-semibold text-fg">
          Convert from quote
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Create a draft invoice from an approved quote. The line items copy
          over; you set the due date.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Search quotes</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Quote # or customer"
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Quote</span>
            <select
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
              required
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="convert-quote-select"
            >
              <option value="">Select a quote…</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.quote_number} — {q.customer_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Due date</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="convert-quote-due-date"
            />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="convert-quote-submit"
            >
              {mutation.isPending ? 'Creating…' : 'Create invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
