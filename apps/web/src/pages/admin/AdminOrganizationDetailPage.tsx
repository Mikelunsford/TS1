/**
 * AdminOrganizationDetailPage — Phase 23 (Wave 10 Session 4).
 * Full org detail with members, feature flags, domains + suspend/unsuspend +
 * impersonate.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AdminShell } from '@/components/admin/AdminShell';
import { ImpersonateButton } from '@/components/admin/ImpersonateButton';
import {
  getAdminOrganization,
  suspendOrganization,
  unsuspendOrganization,
} from '@/lib/services/adminConsoleService';

export default function AdminOrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const detail = useQuery({
    queryKey: ['admin', 'org', id],
    queryFn: () => getAdminOrganization(id!),
    enabled: !!id,
  });

  const suspendMut = useMutation({
    mutationFn: () => suspendOrganization(id!, reason),
    onSuccess: () => {
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin', 'org', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'orgs'] });
    },
  });
  const unsuspendMut = useMutation({
    mutationFn: () => unsuspendOrganization(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'org', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'orgs'] });
    },
  });

  if (detail.isLoading || !detail.data) {
    return (
      <AdminShell>
        <div className="text-slate-400">Loading organization…</div>
      </AdminShell>
    );
  }

  const { org, memberships, feature_flags, domains } = detail.data;
  const isSuspended = org.status === 'suspended';

  return (
    <AdminShell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{org.display_name}</h1>
          <div className="mt-1 flex gap-2 text-xs text-slate-400">
            <span className="font-mono">{org.slug}</span>
            <span>·</span>
            <span>{org.member_count} members</span>
            <span>·</span>
            <span
              className={`rounded px-2 font-semibold uppercase ${
                isSuspended
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {org.status}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isSuspended ? (
            <button
              type="button"
              onClick={() => unsuspendMut.mutate()}
              disabled={unsuspendMut.isPending}
              className="rounded-md border border-emerald-600 bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/40 disabled:opacity-60"
            >
              {unsuspendMut.isPending ? 'Working…' : 'Unsuspend'}
            </button>
          ) : (
            <>
              <input
                type="text"
                placeholder="Reason (optional, audited)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-64 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={() => suspendMut.mutate()}
                disabled={suspendMut.isPending}
                className="rounded-md border border-red-700 bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {suspendMut.isPending ? 'Working…' : 'Suspend'}
              </button>
            </>
          )}
        </div>
      </div>

      <h2 className="mb-2 mt-4 text-lg font-semibold">Members</h2>
      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Active</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.user_id} className="border-t border-slate-800">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-100">
                    {m.display_name ?? m.email ?? m.user_id.slice(0, 8)}
                  </div>
                  <div className="font-mono text-xs text-slate-400">{m.email ?? '—'}</div>
                </td>
                <td className="px-3 py-2 text-slate-300">{m.role}</td>
                <td className="px-3 py-2 text-slate-400">{m.is_active ? 'yes' : 'no'}</td>
                <td className="px-3 py-2 text-right">
                  {m.is_active && (
                    <ImpersonateButton
                      orgId={org.id}
                      userId={m.user_id}
                      userEmail={m.email}
                      userDisplayName={m.display_name}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Feature flags</h2>
      <div className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
        {feature_flags.length === 0 ? (
          <div className="text-slate-500">No feature flags set.</div>
        ) : (
          <ul className="grid grid-cols-2 gap-1">
            {feature_flags.map((f) => (
              <li key={f.flag_key} className="flex justify-between border-b border-slate-800 py-1">
                <span className="font-mono text-xs">{f.flag_key}</span>
                <span
                  className={`text-xs font-semibold ${f.enabled ? 'text-emerald-300' : 'text-slate-500'}`}
                >
                  {f.enabled ? 'enabled' : 'disabled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Domains</h2>
      <div className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
        {domains.length === 0 ? (
          <div className="text-slate-500">No domains configured.</div>
        ) : (
          <ul>
            {domains.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-slate-800 py-1">
                <span className="font-mono">{d.hostname}</span>
                {d.is_primary && (
                  <span className="rounded bg-amber-500/20 px-2 text-xs font-semibold text-amber-300">
                    primary
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-400">SSL: {d.ssl_status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
