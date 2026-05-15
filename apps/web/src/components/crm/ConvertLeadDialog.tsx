/**
 * ConvertLeadDialog — modal form to convert a qualified lead into an
 * opportunity (and optionally a customer). On submit calls
 * `convertLead({id, opportunity_name, amount_cents, currency_code, create_customer})`,
 * invalidates leads/customers/opportunities lists, fires a toast, closes.
 *
 * No Radix here — ESLint config bans `@radix-ui/*`. Rolling a minimal
 * accessible modal with native `<dialog>` semantics: focus trap, ESC to close,
 * backdrop click to close, role=dialog + aria-modal.
 *
 * No `react-hook-form` either — banned in ESLint config. Native React state
 * + Zod parse at submit, per the lint message.
 */
import { useEffect, useRef, useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cn } from '@/lib/cn';
import { LeadConvertSchema, type Lead } from '@/lib/types';
import { toCents } from '@/lib/money';
import { customerKeys } from '@/lib/queryKeys/customers';
import { leadKeys } from '@/lib/queryKeys/leads';
import { opportunityKeys } from '@/lib/queryKeys/opportunities';
import { convertLead } from '@/lib/services/leadsService';

/** Convert result from Backend's leadsService — see services/leadsService.ts */
type LeadConvertResult = {
  lead: Lead;
  customer_id: string;
  opportunity_id: string;
};

type Props = {
  lead: Lead | null;
  /** Default currency when the lead doesn't carry one (e.g., org default). */
  defaultCurrencyCode?: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: (result: LeadConvertResult) => void;
};

export function ConvertLeadDialog({
  lead,
  defaultCurrencyCode = 'USD',
  open,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [opportunityName, setOpportunityName] = useState(lead?.display_name ?? '');
  const [amountInput, setAmountInput] = useState('');
  const [currencyCode, setCurrencyCode] = useState(defaultCurrencyCode);
  const [createCustomer, setCreateCustomer] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset form when the lead changes — derived initial state without useEffect
  // for the value itself, but we DO need an effect to reset when `lead.id`
  // flips (which is a true subscription to "new lead opened").
  useEffect(() => {
    if (open && lead) {
      setOpportunityName(lead.display_name);
      setAmountInput('');
      setCurrencyCode(defaultCurrencyCode);
      setCreateCustomer(true);
      setError(null);
    }
  }, [open, lead, defaultCurrencyCode]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: (vars: {
      id: string;
      opportunity_name: string;
      opportunity_amount_cents: number;
      opportunity_currency_code: string;
      create_customer: boolean;
    }) => {
      const { id, ...body } = vars;
      return convertLead(id, body);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: leadKeys.all }),
        queryClient.invalidateQueries({ queryKey: customerKeys.all }),
        queryClient.invalidateQueries({ queryKey: opportunityKeys.all }),
      ]);
      toast.success(`Lead converted to opportunity ${result.opportunity_id}`);
      onSuccess?.(result as LeadConvertResult);
      onClose();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Conversion failed';
      setError(message);
      toast.error(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    setError(null);

    let amountCents: number;
    try {
      amountCents = toCents(amountInput);
    } catch {
      setError('Enter a valid amount.');
      return;
    }

    const parsed = LeadConvertSchema.safeParse({
      opportunity_name: opportunityName,
      opportunity_amount_cents: amountCents,
      opportunity_currency_code: currencyCode,
      create_customer: createCustomer,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid form data');
      return;
    }

    mutation.mutate({
      id: lead.id,
      opportunity_name: parsed.data.opportunity_name,
      opportunity_amount_cents: amountCents,
      opportunity_currency_code: parsed.data.opportunity_currency_code ?? currencyCode,
      create_customer: parsed.data.create_customer,
    });
  };

  if (!open || !lead) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="convert-lead-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-fg/40"
      />
      <div
        ref={dialogRef}
        className="relative w-full max-w-md p-6 rounded-lg border border-border bg-bg shadow-lg"
      >
        <h2 id="convert-lead-title" className="text-lg font-semibold text-fg">
          Convert lead
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Create an opportunity from {lead.display_name}.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Opportunity name</span>
            <input
              type="text"
              required
              value={opportunityName}
              onChange={(e) => setOpportunityName(e.target.value)}
              className="px-3 py-2 rounded border border-border bg-bg text-fg"
              data-testid="opportunity-name-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Amount</span>
            <input
              type="text"
              required
              inputMode="decimal"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="px-3 py-2 rounded border border-border bg-bg text-fg"
              data-testid="amount-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Currency</span>
            <input
              type="text"
              required
              maxLength={3}
              minLength={3}
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
              className="px-3 py-2 rounded border border-border bg-bg text-fg uppercase"
              data-testid="currency-input"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createCustomer}
              onChange={(e) => setCreateCustomer(e.target.checked)}
              data-testid="create-customer-checkbox"
            />
            <span className="text-fg">Also create customer</span>
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-sm text-fg hover:bg-bg-subtle"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className={cn(
                'px-3 py-1.5 rounded text-sm font-medium bg-brand text-brand-fg',
                mutation.isPending ? 'opacity-60' : 'hover:opacity-90',
              )}
              data-testid="convert-submit"
            >
              {mutation.isPending ? 'Converting…' : 'Convert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
