import { useMe } from '@/lib/hooks/useMe';

/**
 * Wave 1 home page. Now sits inside the AppShell (Topbar + Sidebar), so
 * the workspace switcher and sign-out controls live in the topbar. This
 * page shows the active workspace + remaining-wave roadmap.
 */
export default function PlaceholderHome() {
  const { data, isLoading, error } = useMe();
  const activeOrg = data?.memberships.find((m) => m.org_id === data.active_org_id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-fg-subtle">Wave 1</p>
        <h1 className="text-3xl font-semibold">Identity &amp; tenancy is live.</h1>
        <p className="text-fg-muted">
          The shell, workspace switcher, and branding substrate are wired. Module pages land in
          Waves 2+.
        </p>
      </header>

      <section className="rounded-md border border-border bg-bg-muted p-4">
        <p className="text-xs uppercase tracking-wide text-fg-subtle">Active workspace</p>
        {isLoading && <p className="font-mono text-sm">Loading…</p>}
        {error && (
          <p className="text-sm text-danger">
            Could not load workspace ({error instanceof Error ? error.message : 'unknown error'}).
          </p>
        )}
        {data && (
          <>
            <p className="text-lg font-semibold">
              {activeOrg?.display_name ?? 'No active org'}
            </p>
            <p className="text-sm text-fg-muted">
              Signed in as <span className="font-mono">{data.email}</span>
              {activeOrg && (
                <>
                  {' · '}role <span className="font-mono">{activeOrg.role}</span>
                </>
              )}
            </p>
          </>
        )}
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="font-medium">What ships next</h2>
        <ul className="ml-5 list-disc text-sm text-fg-muted">
          <li>Wave 2: CRM core (leads, customers, opportunities, activities, mentions).</li>
          <li>Wave 3: quote-to-cash.</li>
          <li>Wave 4: procurement &amp; inventory.</li>
        </ul>
      </section>
    </div>
  );
}
