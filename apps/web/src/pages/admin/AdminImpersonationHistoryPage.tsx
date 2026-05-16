/**
 * AdminImpersonationHistoryPage — Phase 23 (Wave 10 Session 4).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { AdminShell } from '@/components/admin/AdminShell';
import { getImpersonationHistory } from '@/lib/services/adminConsoleService';

export default function AdminImpersonationHistoryPage() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin', 'history', { page }],
    queryFn: () => getImpersonationHistory({ page }),
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pageSize = q.data?.page_size ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AdminShell>
      <h1 className="mb-6 text-2xl font-semibold">Impersonation History</h1>
      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2 text-left">Admin</th>
              <th className="px-3 py-2 text-left">Impersonated user</th>
              <th className="px-3 py-2 text-left">Org</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-left">Ended</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
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
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>
          {total} events · page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </AdminShell>
  );
}
