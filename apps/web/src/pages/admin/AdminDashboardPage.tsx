/**
 * AdminDashboardPage — Phase 23 (Wave 10 Session 4).
 * KPI tiles + recent impersonations.
 */
import { useQuery } from '@tanstack/react-query';

import { AdminShell } from '@/components/admin/AdminShell';
import {
  listAdminOrganizations,
  getImpersonationHistory,
} from '@/lib/services/adminConsoleService';

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const orgs = useQuery({
    queryKey: ['admin', 'orgs', 'count'],
    queryFn: () => listAdminOrganizations({ pageSize: 1 }),
  });
  const history = useQuery({
    queryKey: ['admin', 'history', 'recent'],
    queryFn: () => getImpersonationHistory({ page: 1 }),
  });

  const activeImp =
    history.data?.items.filter((i) => i.ended_at === null).length ?? 0;

  return (
    <AdminShell>
      <h1 className="mb-6 text-2xl font-semibold">Platform Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        <Tile label="Total organizations" value={orgs.data?.total ?? '—'} />
        <Tile label="Active impersonations" value={activeImp} />
        <Tile label="Total impersonation events" value={history.data?.total ?? '—'} />
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Recent impersonations</h2>
      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Admin</th>
              <th className="px-3 py-2 text-left">Impersonated user</th>
              <th className="px-3 py-2 text-left">Org</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">Ended</th>
            </tr>
          </thead>
          <tbody>
            {(history.data?.items ?? []).slice(0, 10).map((row) => (
              <tr key={row.id} className="border-t border-slate-800">
                <td className="px-3 py-2 text-slate-300">
                  {new Date(row.started_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {row.admin_user_id.slice(0, 8)}…
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {row.impersonated_user_id.slice(0, 8)}…
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {row.org_id.slice(0, 8)}…
                </td>
                <td className="px-3 py-2 text-slate-300">{row.reason}</td>
                <td className="px-3 py-2 text-slate-400">
                  {row.ended_at ? new Date(row.ended_at).toLocaleString() : 'active'}
                </td>
              </tr>
            ))}
            {history.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!history.isLoading && (history.data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  No impersonation events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
