/**
 * ConvertFromProjectDialog — modal that picks a project and a due date,
 * then POSTs `/invoicing-api/invoices/from-project`. Hand-rolled modal,
 * no Radix.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { projectKeys } from '@/lib/queryKeys/projects';
import { convertFromProject } from '@/lib/services/invoicesService';
import { listProjects } from '@/lib/services/projectsService';
import {
  InvoiceConvertFromProjectSchema,
  type InvoiceConvertFromProject,
} from '@/lib/types';

export interface ConvertFromProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ConvertFromProjectDialog({ open, onClose }: ConvertFromProjectDialogProps) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProjectId('');
      setDueDate('');
      setSearch('');
      setError(null);
    }
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: [...projectKeys.list(), { q: search }],
    queryFn: () => listProjects(search ? { q: search } : {}),
    staleTime: 30_000,
    enabled: open,
  });

  const projects = projectsQuery.data?.items ?? [];

  const mutation = useMutation({
    mutationFn: (body: InvoiceConvertFromProject) => convertFromProject(body),
    onSuccess: (inv) => {
      toast.success(`Invoice ${inv.invoice_number} created from project`);
      onClose();
      navigate(`/invoices/${inv.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Convert failed'),
  });

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
    const candidate = { project_id: projectId, due_date: dueDate };
    const parsed = InvoiceConvertFromProjectSchema.safeParse(candidate);
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
      aria-labelledby="convert-from-project-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="convert-from-project-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-fg/40"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-bg p-6 shadow-lg">
        <h2 id="convert-from-project-title" className="text-lg font-semibold text-fg">
          Convert from project
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Create a draft invoice from a project. You set the due date.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Search projects</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Project name or customer"
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="convert-project-select"
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.customer_name ? ` — ${p.customer_name}` : ''}
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
              data-testid="convert-project-due-date"
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
              data-testid="convert-project-submit"
            >
              {mutation.isPending ? 'Creating…' : 'Create invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
