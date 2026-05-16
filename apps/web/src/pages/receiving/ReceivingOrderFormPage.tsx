/**
 * ReceivingOrderFormPage — Create receiving order (Wave 8f / Phase 13).
 * Edits route to the detail page (the BE PATCH only accepts a narrow set
 * of header fields on non-terminal ROs — we surface them inline on detail).
 *
 * `source` is one of customer_supplied | t1_purchase. `bom_item_id` is
 * optional (RO may be ad-hoc receipts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { receivingOrderKeys } from '@/lib/queryKeys/receivingOrders';
import { createReceivingOrder } from '@/lib/services/receivingOrdersService';
import { listProjects } from '@/lib/services/projectsService';
import {
  ReceivingOrderCreateSchema,
  type ReceivingOrderCreate,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof ReceivingOrderCreate, string[] | undefined>>;

export default function ReceivingOrderFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ['crm', 'projects', 'lookup', { limit: 200 }],
    queryFn: () => listProjects({ limit: 200 }),
    staleTime: 60_000,
  });

  const [projectId, setProjectId] = useState('');
  const [source, setSource] = useState<'customer_supplied' | 't1_purchase'>('t1_purchase');
  const [expectedQty, setExpectedQty] = useState('');
  const [vendor, setVendor] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: ReceivingOrderCreate) => createReceivingOrder(body),
    onSuccess: (data) => {
      toast.success(`Receiving order ${data.ro_number} created`);
      void qc.invalidateQueries({ queryKey: receivingOrderKeys.all });
      navigate(`/receiving/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const candidate: Record<string, unknown> = {
      project_id: projectId,
      source,
      expected_qty: Number(expectedQty),
      vendor: vendor.trim() === '' ? null : vendor,
      expected_at: expectedAt === '' ? null : new Date(expectedAt).toISOString(),
      notes: notes.trim() === '' ? null : notes,
    };
    const parsed = ReceivingOrderCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      setTopError('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/receiving" className="hover:underline">Receiving orders</Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <h1 className="text-2xl font-semibold">New receiving order</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <Field label="Project" error={errors.project_id} required>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
            data-testid="ro-project"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">Select a project…</option>
            {(projectsQuery.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Source" error={errors.source} required>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="ro-source"
          >
            <option value="t1_purchase">T1 purchase</option>
            <option value="customer_supplied">Customer supplied</option>
          </select>
        </Field>

        <Field label="Expected qty" error={errors.expected_qty} required>
          <input
            type="number"
            step="any"
            min={0}
            required
            value={expectedQty}
            onChange={(e) => setExpectedQty(e.target.value)}
            className="w-32 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="ro-expected-qty"
          />
        </Field>

        <Field label="Vendor" error={errors.vendor}>
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Expected at" error={errors.expected_at}>
          <input
            type="datetime-local"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Notes" error={errors.notes}>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        {topError && (
          <p role="alert" className="text-sm text-danger">{topError}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to="/receiving"
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="ro-submit"
          >
            {createMutation.isPending ? 'Saving…' : 'Create receiving order'}
          </button>
        </div>
      </form>
    </div>
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
      {error && error.length > 0 && (
        <span className="text-xs text-danger">{error.join(', ')}</span>
      )}
    </label>
  );
}
