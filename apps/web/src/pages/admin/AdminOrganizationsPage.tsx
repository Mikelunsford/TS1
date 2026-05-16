/**
 * AdminOrganizationsPage — Phase 23 (Wave 10 Session 4).
 * List, search, paginate every organization in the system.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { AdminShell } from '@/components/admin/AdminShell';
import { listAdminOrganizations } from '@/lib/services/adminConsoleService';

export default function AdminOrganizationsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const orgs = useQuery({
    queryKey: ['admin', 'orgs', { search, page }],
    queryFn: () => listAdminOrganizations({ search, page, pageSize: 25 }),
  });

  const items = orgs.data?.items ?? [];
  const total = orgs.data?.total ?? 0;
  const pageSize = orgs.data?.page_size ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AdminShell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <Link
          to="/admin/organizations/new"
          className="rounded-md border border-amber-600 bg-amber-500/20 px-3 py-1.5 text-sm font-semibold text-amber-200 hover:bg-amber-500/40"
        >
          + Provision Org
        </Link>
      </div>
      <input
        type="search"
        placeholder="Search by name or slug…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="mb-4 w-full max-w-md rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
      />
      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Slug</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Members</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                <td className="px-3 py-2">
                  <Link
                    to={`/admin/organizations/${o.id}`}
                    className="text-slate-100 underline-offset-2 hover:underline"
                  >
                    {o.display_name}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">{o.slug}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                      o.status === 'suspended'
                        ? 'bg-red-500/20 text-red-300'
                        : o.status === 'archived'
                          ? 'bg-slate-700 text-slate-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {o.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-300">{o.member_count}</td>
                <td className="px-3 py-2 text-slate-400">
                  {new Date(o.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {orgs.isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!orgs.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>
          {total} organizations · page {page} of {totalPages}
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
