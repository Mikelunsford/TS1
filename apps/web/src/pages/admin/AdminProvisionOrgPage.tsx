/**
 * AdminProvisionOrgPage — Phase 23 (Wave 10 Session 4).
 * Form for creating a new tenant.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import { AdminShell } from '@/components/admin/AdminShell';
import { provisionOrganization } from '@/lib/services/adminConsoleService';

export default function AdminProvisionOrgPage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      provisionOrganization({
        name,
        slug,
        owner_email: ownerEmail,
        owner_full_name: ownerName,
      }),
    onSuccess: (res) => {
      nav(`/admin/organizations/${res.org.id}`);
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'provision failed');
    },
  });

  return (
    <AdminShell>
      <h1 className="mb-6 text-2xl font-semibold">Provision new organization</h1>
      <form
        className="max-w-lg space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mut.mutate();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">Display name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">Slug (URL-safe)</span>
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-slate-100"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">Owner email</span>
          <input
            type="email"
            required
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-400">Owner full name</span>
          <input
            type="text"
            required
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          />
        </label>
        {error && (
          <div className="rounded-md border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={mut.isPending}
          className="rounded-md border border-amber-600 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/40 disabled:opacity-60"
        >
          {mut.isPending ? 'Provisioning…' : 'Provision'}
        </button>
      </form>
    </AdminShell>
  );
}
