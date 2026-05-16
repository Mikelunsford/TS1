import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatDate } from '@/lib/format';
import { portalKeys } from '@/lib/queryKeys/portal';
import { listPortalProjects } from '@/lib/services/portalService';

export default function PortalProjectsPage() {
  const [status, setStatus] = useState<string>('');
  const filters = useMemo(() => ({ status: status || undefined, page_size: 25 }), [status]);
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.projectList(filters),
    queryFn: () => listPortalProjects(filters),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">Status</span>
          <input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="filter…"
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
          />
        </label>
      </header>

      {isLoading && <p className="text-fg-muted">Loading projects…</p>}
      {isError && <p className="text-red-600">Failed to load projects.</p>}
      {data && data.items.length === 0 && <p className="text-fg-muted">No projects yet.</p>}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-2">Project #</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Due</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((rawRow) => {
                const row = rawRow as Record<string, unknown> & {
                  id: string;
                  project_number: string;
                  name: string;
                  status: string;
                  due_date: string | null;
                };
                return (
                  <tr key={row.id} className="border-t border-border hover:bg-bg-subtle">
                    <td className="px-3 py-2">
                      <Link to={`/portal/projects/${row.id}`} className="text-[rgb(var(--brand))] hover:underline">
                        {row.project_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2 capitalize">{row.status.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2">{formatDate(row.due_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
