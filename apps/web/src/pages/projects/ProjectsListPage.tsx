import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ExportButton } from '@/components/exports/ExportButton';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ProjectStatusBadge } from '@/components/projects/ProjectStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { can } from '@/lib/capabilities';
import { formatDate } from '@/lib/formatDate';
import { useActiveRole } from '@/lib/hooks/useActiveRole';
import { projectKeys } from '@/lib/queryKeys/projects';
import { listProjects, type ProjectListFilters } from '@/lib/services/projectsService';
import { ProjectStateSchema } from '@/lib/types';

const STATUS_FILTERS = ProjectStateSchema.options;

/**
 * Projects list — table with status filter chips, customer dropdown (TODO:
 * lights up when the customers picker integration lands), free-text q search,
 * and pagination via `next_cursor`. Mirrors ItemsListPage's URL-state pattern
 * so filters survive reload + back-button.
 *
 * "New Project" is cap-gated on `projects.write`; most projects come via the
 * quote-convert flow so this route is the fallback for ops creating one
 * manually. The button hides for viewer / customer_user roles.
 */
export default function ProjectsListPage() {
  const role = useActiveRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const customerId = searchParams.get('customer_id') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);

  const filters: ProjectListFilters = {};
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (customerId) filters.customer_id = customerId;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () => listProjects(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if ('q' in next || 'status' in next || 'customer_id' in next) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  const canCreate = can(role, 'projects.write');

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-fg-muted">
            Production jobs converted from quotes or created directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="projects" />
          {canCreate && (
            <Link
              to="/projects/new"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="projects-new-link"
            >
              New project
            </Link>
          )}
        </div>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Project filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="projects-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="projects-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Project number or name"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
        >
          Apply
        </button>
      </form>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
        <StatusChip
          label="All"
          active={status === ''}
          onClick={() => update({ status: '' })}
        />
        {STATUS_FILTERS.map((s) => (
          <StatusChip
            key={s}
            label={s.replace(/_/g, ' ')}
            active={status === s}
            onClick={() => update({ status: s })}
          />
        ))}
      </div>

      {query.isLoading && <TableSkeleton rows={6} cols={7} />}
      {query.error && <ErrorState title="Could not load projects" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No projects found"
          description={
            q || status || customerId
              ? 'Try clearing filters to see all projects.'
              : 'Projects converted from quotes (or created directly) will appear here.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Number
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Currency
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Due
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((p) => (
                <tr key={p.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/projects/${p.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {p.project_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2">
                    <ProjectStatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2">
                    {p.customer_name ?? <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.currency_code}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={p.total_cents} currency={p.currency_code} />
                  </td>
                  <td className="px-3 py-2">{formatDate(p.due_date)}</td>
                  <td className="px-3 py-2">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.data?.next_cursor && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => update({ cursor: query.data?.next_cursor ?? undefined })}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Next page
          </button>
        </div>
      )}
    </div>
  );
}

function StatusChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-full bg-brand px-3 py-1 text-xs font-medium capitalize text-brand-fg'
          : 'rounded-full border border-border bg-bg px-3 py-1 text-xs capitalize text-fg-muted hover:bg-bg-muted'
      }
    >
      {label}
    </button>
  );
}
