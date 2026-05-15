import { useAuth } from '@/auth/AuthContext';

export default function PlaceholderHome() {
  const { state, signOut } = useAuth();
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-12">
      <header className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-fg-subtle">Wave 0</p>
        <h1 className="text-3xl font-semibold">Team1 — placeholder shell</h1>
        <p className="text-fg-muted">
          The build pipeline is green. Real pages, primitives, and business logic land in Wave 1+.
        </p>
      </header>

      {state.status === 'authenticated' && (
        <section className="rounded-md border border-border bg-bg-muted p-4">
          <p className="text-sm text-fg-muted">Signed in as</p>
          <p className="font-mono text-sm">{state.user.email}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 rounded-md border border-border-strong bg-bg px-3 py-1.5 text-sm hover:bg-bg-subtle"
          >
            Sign out
          </button>
        </section>
      )}

      <section className="rounded-md border border-border p-4">
        <h2 className="font-medium">What ships next</h2>
        <ul className="ml-5 list-disc text-sm text-fg-muted">
          <li>Wave 1: orgs, memberships, roles, JWT claims, RLS defense-in-depth, branding.</li>
          <li>Wave 2: CRM core (leads, customers, opportunities, activities, mentions).</li>
          <li>Wave 3: quote-to-cash.</li>
        </ul>
      </section>
    </main>
  );
}
