import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { PhasesEditor } from '@/components/projects/PhasesEditor';
import { ProjectStatusBadge } from '@/components/projects/ProjectStatusBadge';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { can } from '@/lib/capabilities';
import { formatDate } from '@/lib/formatDate';
import { useActiveRole } from '@/lib/hooks/useActiveRole';
import { projectKeys } from '@/lib/queryKeys/projects';
import { listPhases } from '@/lib/services/projectPhasesService';
import {
  closeProject,
  getProject,
  reopenProject,
  updateProject,
} from '@/lib/services/projectsService';
import type { ProjectPatch, ProjectReopen } from '@/lib/types';

/**
 * ProjectDetailPage — header card with project metadata, lifecycle button
 * strip (Close / Reopen / Edit), and the phases editor.
 *
 * Lifecycle buttons:
 *   - Close: visible while status ∈ {in_production, ready_to_ship} (matches
 *     the BE close handler's gating). Cap: projects.close.
 *   - Reopen: visible only on status=completed. Cap: projects.close. The
 *     dialog asks the operator which prior state to drop into; default
 *     in_production matches the BE handler's default.
 *   - Edit: opens an edit dialog (name / customer_name / currency /
 *     budget / due_date / quote_id). Cap: projects.write.
 */
export default function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const role = useActiveRole();
  const queryClient = useQueryClient();

  const projectQuery = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const phasesQuery = useQuery({
    queryKey: projectKeys.phases(id),
    queryFn: () => listPhases(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const closeMutation = useMutation({
    mutationFn: (reason: string) =>
      closeProject(id, reason.trim() === '' ? {} : { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Project closed');
      setCloseOpen(false);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: () => toast.error('Failed to close project'),
  });

  const reopenMutation = useMutation({
    mutationFn: (body: ProjectReopen) => reopenProject(id, body),
    onSuccess: () => {
      toast.success('Project reopened');
      setReopenOpen(false);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: () => toast.error('Failed to reopen project'),
  });

  const editMutation = useMutation({
    mutationFn: (patch: ProjectPatch) => updateProject(id, patch),
    onSuccess: () => {
      toast.success('Project updated');
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
    },
    onError: () => toast.error('Failed to update project'),
  });

  if (projectQuery.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (projectQuery.error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <ErrorState title="Could not load project" error={projectQuery.error} />
      </div>
    );
  }
  if (!projectQuery.data) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <EmptyState title="Project not found" description="This project may have been deleted." />
      </div>
    );
  }

  const project = projectQuery.data;
  const canWrite = can(role, 'projects.write');
  const canClose = can(role, 'projects.close');

  const closable =
    canClose && (project.status === 'in_production' || project.status === 'ready_to_ship');
  const reopenable = canClose && project.status === 'completed';

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/projects" className="hover:underline">
          Projects
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{project.project_number}</span>
      </nav>

      <section
        aria-labelledby="project-header-heading"
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <header className="flex flex-wrap items-center gap-3">
          <h1 id="project-header-heading" className="text-2xl font-semibold">
            {project.name}
          </h1>
          <ProjectStatusBadge status={project.status} />
          <span className="font-mono text-sm text-fg-muted">{project.project_number}</span>
        </header>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Customer</dt>
            <dd className="text-fg">
              {project.customer_name ?? <span className="text-fg-muted">—</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
            <dd className="font-mono text-fg">{project.currency_code}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Due date</dt>
            <dd className="text-fg">{formatDate(project.due_date)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Total</dt>
            <dd className="font-mono text-fg">
              <MoneyDisplay cents={project.total_cents} currency={project.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Budget</dt>
            <dd className="font-mono text-fg">
              <MoneyDisplay cents={project.budget_cents} currency={project.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Created</dt>
            <dd className="text-fg">{formatDate(project.created_at)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
              data-testid="project-edit"
            >
              Edit
            </button>
          )}
          {closable && (
            <button
              type="button"
              onClick={() => setCloseOpen(true)}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
              data-testid="project-close"
            >
              Close project
            </button>
          )}
          {reopenable && (
            <button
              type="button"
              onClick={() => setReopenOpen(true)}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
              data-testid="project-reopen"
            >
              Reopen
            </button>
          )}
        </div>
      </section>

      {closeOpen && (
        <CloseDialog
          onCancel={() => setCloseOpen(false)}
          onConfirm={(reason) => closeMutation.mutate(reason)}
          busy={closeMutation.isPending}
        />
      )}

      {reopenOpen && (
        <ReopenDialog
          onCancel={() => setReopenOpen(false)}
          onConfirm={(to) => reopenMutation.mutate({ to })}
          busy={reopenMutation.isPending}
        />
      )}

      {editOpen && (
        <EditDialog
          initial={{
            name: project.name,
            customer_name: project.customer_name ?? '',
            quote_id: project.quote_id ?? '',
            currency_code: project.currency_code,
            budget_cents:
              typeof project.budget_cents === 'number'
                ? project.budget_cents
                : Number(project.budget_cents),
            due_date: project.due_date ? project.due_date.slice(0, 10) : '',
          }}
          onCancel={() => setEditOpen(false)}
          onConfirm={(patch) => editMutation.mutate(patch)}
          busy={editMutation.isPending}
        />
      )}

      {phasesQuery.isLoading && <Skeleton className="h-32 w-full" />}
      {phasesQuery.error && (
        <ErrorState title="Could not load phases" error={phasesQuery.error} />
      )}
      {phasesQuery.data && (
        <PhasesEditor
          projectId={id}
          phases={phasesQuery.data.items}
          currency={project.currency_code}
        />
      )}
    </div>
  );
}

function CloseDialog({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-dialog-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <h2 id="close-dialog-heading" className="text-lg font-semibold">
        Close project
      </h2>
      <p className="text-sm text-fg-muted">
        Marks the project as completed. Optionally record a reason; it will appear in the
        activity log.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Optional reason"
        className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(reason)}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          data-testid="project-close-confirm"
        >
          {busy ? 'Closing…' : 'Confirm close'}
        </button>
      </div>
    </div>
  );
}

function ReopenDialog({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: (to: 'in_production' | 'ready_to_ship') => void;
  busy: boolean;
}) {
  const [to, setTo] = useState<'in_production' | 'ready_to_ship'>('in_production');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reopen-dialog-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <h2 id="reopen-dialog-heading" className="text-lg font-semibold">
        Reopen project
      </h2>
      <p className="text-sm text-fg-muted">Choose the state to drop the project back into.</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="reopen-to"
            value="in_production"
            checked={to === 'in_production'}
            onChange={() => setTo('in_production')}
          />
          In production
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="reopen-to"
            value="ready_to_ship"
            checked={to === 'ready_to_ship'}
            onChange={() => setTo('ready_to_ship')}
          />
          Ready to ship
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(to)}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          data-testid="project-reopen-confirm"
        >
          {busy ? 'Reopening…' : 'Confirm reopen'}
        </button>
      </div>
    </div>
  );
}

interface EditInitial {
  name: string;
  customer_name: string;
  quote_id: string;
  currency_code: string;
  budget_cents: number;
  due_date: string;
}

function EditDialog({
  initial,
  onCancel,
  onConfirm,
  busy,
}: {
  initial: EditInitial;
  onCancel: () => void;
  onConfirm: (patch: ProjectPatch) => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<EditInitial>(initial);

  function submit() {
    const patch: ProjectPatch = {};
    if (form.name !== initial.name) patch.name = form.name;
    if (form.customer_name !== initial.customer_name) {
      patch.customer_name = form.customer_name === '' ? null : form.customer_name;
    }
    if (form.quote_id !== initial.quote_id) {
      patch.quote_id = form.quote_id === '' ? null : form.quote_id;
    }
    if (form.currency_code !== initial.currency_code) patch.currency_code = form.currency_code;
    if (form.budget_cents !== initial.budget_cents) patch.budget_cents = form.budget_cents;
    if (form.due_date !== initial.due_date) {
      patch.due_date = form.due_date === '' ? null : `${form.due_date}T00:00:00Z`;
    }
    onConfirm(patch);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-dialog-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <h2 id="edit-dialog-heading" className="text-lg font-semibold">
        Edit project
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label="Customer name">
          <input
            type="text"
            value={form.customer_name}
            onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label="Quote ID (optional)">
          <input
            type="text"
            value={form.quote_id}
            onChange={(e) => setForm({ ...form, quote_id: e.target.value })}
            placeholder="UUID of source quote"
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label="Currency">
          <input
            type="text"
            maxLength={3}
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
            className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label="Budget">
          <MoneyInput
            value={form.budget_cents}
            onChange={(c) => setForm({ ...form, budget_cents: c })}
            currency={form.currency_code}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}
