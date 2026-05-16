/**
 * ProductionRunFormPage — Create a production run (Wave 8f / Phase 13).
 * BE enforces UNIQUE active run per project — 409 STATE_CONFLICT if a
 * non-terminal run already exists.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { productionRunKeys } from '@/lib/queryKeys/productionRuns';
import { createProductionRun } from '@/lib/services/productionRunsService';
import { listProjects } from '@/lib/services/projectsService';
import {
  ProductionRunCreateSchema,
  type ProductionRunCreate,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof ProductionRunCreate, string[] | undefined>>;

export default function ProductionRunFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ['crm', 'projects', 'lookup', { limit: 200 }],
    queryFn: () => listProjects({ limit: 200 }),
    staleTime: 60_000,
  });

  const [projectId, setProjectId] = useState('');
  const [qtyTarget, setQtyTarget] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: ProductionRunCreate) => createProductionRun(body),
    onSuccess: (data) => {
      toast.success(`Run ${data.run_number} created`);
      void qc.invalidateQueries({ queryKey: productionRunKeys.all });
      navigate(`/production/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const candidate: Record<string, unknown> = {
      project_id: projectId,
      qty_target: Number(qtyTarget),
      scheduled_for: scheduledFor === '' ? null : new Date(scheduledFor).toISOString(),
      notes: notes.trim() === '' ? null : notes,
    };
    const parsed = ProductionRunCreateSchema.safeParse(candidate);
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
        <Link to="/production" className="hover:underline">Production runs</Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <h1 className="text-2xl font-semibold">New production run</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <Field label="Project" error={errors.project_id} required>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
            data-testid="run-project"
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

        <Field label="Target qty" error={errors.qty_target} required>
          <input
            type="number"
            step="any"
            min={0}
            required
            value={qtyTarget}
            onChange={(e) => setQtyTarget(e.target.value)}
            className="w-32 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="run-qty-target"
          />
        </Field>

        <Field label="Scheduled for" error={errors.scheduled_for}>
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
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
            to="/production"
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="run-submit"
          >
            {createMutation.isPending ? 'Saving…' : 'Create run'}
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
