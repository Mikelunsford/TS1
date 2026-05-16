import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { formatDate } from '@/lib/format';
import { portalKeys } from '@/lib/queryKeys/portal';
import { getPortalProject } from '@/lib/services/portalService';

export default function PortalProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.project(id),
    queryFn: () => getPortalProject(id),
    enabled: Boolean(id),
  });

  if (isLoading) return <p className="p-6 text-fg-muted">Loading project…</p>;
  if (isError || !data) return <p className="p-6 text-red-600">Failed to load project.</p>;

  const p = data.project as Record<string, unknown> & {
    project_number: string;
    name: string;
    status: string;
    due_date: string | null;
    bom_finalized_at: string | null;
    sent_to_production_at: string | null;
    production_started_at: string | null;
    production_completed_at: string | null;
    ready_to_ship_at: string | null;
    shipping_completed_at: string | null;
  };

  const timeline = [
    { label: 'BOM finalized', at: p.bom_finalized_at },
    { label: 'Sent to production', at: p.sent_to_production_at },
    { label: 'Production started', at: p.production_started_at },
    { label: 'Production completed', at: p.production_completed_at },
    { label: 'Ready to ship', at: p.ready_to_ship_at },
    { label: 'Shipping completed', at: p.shipping_completed_at },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Link to="/portal/projects" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to projects
      </Link>

      <header>
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="text-fg-muted">
          {p.project_number} · <span className="capitalize">{p.status.replace(/_/g, ' ')}</span>
          {p.due_date && <> · Due {formatDate(p.due_date)}</>}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-fg-subtle">Milestones</h2>
        <ul className="space-y-2">
          {timeline.map((m) => (
            <li key={m.label} className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm">
              <span className={m.at ? 'font-medium' : 'text-fg-muted'}>{m.label}</span>
              <span className="text-fg-muted">{m.at ? formatDate(m.at) : '—'}</span>
            </li>
          ))}
        </ul>
      </section>

      {data.phases.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-fg-subtle">Phases</h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Planned start</th>
                  <th className="px-3 py-2">Planned end</th>
                </tr>
              </thead>
              <tbody>
                {data.phases.map((rawPhase) => {
                  const ph = rawPhase as Record<string, unknown> & {
                    id: string;
                    position: number;
                    name: string;
                    status: string;
                    planned_start_at: string | null;
                    planned_end_at: string | null;
                  };
                  return (
                    <tr key={ph.id} className="border-t border-border">
                      <td className="px-3 py-2">{ph.position}</td>
                      <td className="px-3 py-2">{ph.name}</td>
                      <td className="px-3 py-2 capitalize">{ph.status}</td>
                      <td className="px-3 py-2">{formatDate(ph.planned_start_at)}</td>
                      <td className="px-3 py-2">{formatDate(ph.planned_end_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
