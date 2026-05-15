import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/ui/MoneyInput';
import { projectKeys } from '@/lib/queryKeys/projects';
import { createProject } from '@/lib/services/projectsService';
import { ProjectCreateSchema, type ProjectCreate } from '@/lib/types';

type FieldErrors = Partial<Record<keyof ProjectCreate, string[] | undefined>>;

function emptyForm(): ProjectCreate {
  return {
    name: '',
    customer_id: null,
    customer_name: null,
    quote_id: null,
    currency_code: 'USD',
    total_cents: 0,
    budget_cents: 0,
    due_date: null,
  };
}

/**
 * ProjectCreatePage — direct create flow. Most projects come via the
 * quote-convert RPC; this surface is the fallback for ops creating a project
 * outside the quoting workflow. Customer is captured as free-text
 * `customer_name`; the FK `customer_id` is left null until F-Wave4-09 wires
 * a proper customer picker. Form uses bare React state + Zod safeParse on
 * submit, matching the Wave 3 R-01 reconciliation.
 */
export default function ProjectCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProjectCreate>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: (body: ProjectCreate) => createProject(body),
    onSuccess: (project) => {
      toast.success('Project created');
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      navigate(`/projects/${project.id}`);
    },
    onError: () => toast.error('Failed to create project'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate: ProjectCreate = {
      ...form,
      customer_name:
        form.customer_name && form.customer_name.trim() !== '' ? form.customer_name : null,
      quote_id: form.quote_id && form.quote_id.trim() !== '' ? form.quote_id : null,
      due_date: form.due_date && form.due_date !== '' ? form.due_date : null,
    };
    const parsed = ProjectCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/projects" className="hover:underline">
          Projects
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="text-sm text-fg-muted">
          Direct create. To start a project from a quote, use the quote&apos;s
          &ldquo;Convert to project&rdquo; action instead.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label
              htmlFor="project-name"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Name
            </label>
            <input
              id="project-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="project-name-input"
            />
            {errors.name && <span className="text-xs text-danger">{errors.name[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="project-customer-name"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Customer name
            </label>
            <input
              id="project-customer-name"
              type="text"
              value={form.customer_name ?? ''}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              placeholder="Free-text; customer picker arrives later"
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="project-quote-id"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Source quote (optional)
            </label>
            <input
              id="project-quote-id"
              type="text"
              value={form.quote_id ?? ''}
              onChange={(e) => setForm({ ...form, quote_id: e.target.value })}
              placeholder="UUID"
              className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="project-currency"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Currency
            </label>
            <input
              id="project-currency"
              type="text"
              maxLength={3}
              value={form.currency_code ?? ''}
              onChange={(e) =>
                setForm({ ...form, currency_code: e.target.value.toUpperCase() })
              }
              className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="project-budget"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Budget
            </label>
            <MoneyInput
              id="project-budget"
              value={typeof form.budget_cents === 'number' ? form.budget_cents : 0}
              onChange={(c) => setForm({ ...form, budget_cents: c })}
              currency={form.currency_code ?? 'USD'}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="project-due-date"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Due date
            </label>
            <input
              id="project-due-date"
              type="date"
              value={form.due_date ? form.due_date.slice(0, 10) : ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  due_date: e.target.value === '' ? null : `${e.target.value}T00:00:00Z`,
                })
              }
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Link
            to="/projects"
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="project-create-submit"
          >
            {mutation.isPending ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
