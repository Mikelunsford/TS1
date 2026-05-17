/**
 * ContactDetailPage — read-only contact detail surface with collaboration.
 *
 * Closes R-W10-S2-B1-OBS-02 (one of three entity types the list-only
 * wave-2 build deferred). The page renders header, key fields, and the
 * Wave-10 Phase-16 <CollaborationSection> so comments + files attach
 * to a `contact` entity row.
 *
 * Editing is deferred — the CRM contacts module has list-CRUD via the
 * list-page row drawer; a dedicated edit page can layer on without a
 * route shape change.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { contactKeys } from '@/lib/queryKeys/contacts';
import { getContact } from '@/lib/services/contactsService';

export default function ContactDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  const contactQuery = useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: () => getContact(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const contact = contactQuery.data;
  const fullName = contact
    ? `${contact.first_name}${contact.last_name ? ` ${contact.last_name}` : ''}`
    : '…';

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/crm/contacts" className="hover:underline">
          Contacts
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{fullName}</span>
      </nav>

      {contactQuery.isLoading && <Skeleton className="h-40 w-full" />}
      {contactQuery.error && (
        <ErrorState title="Could not load contact" error={contactQuery.error} />
      )}
      {contactQuery.isSuccess && !contact && (
        <EmptyState title="Contact not found" description="It may have been deleted." />
      )}

      {contact && (
        <>
          <header className="space-y-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              <span>{fullName}</span>
              {contact.is_primary && (
                <span className="rounded bg-brand-subtle px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-brand">
                  Primary
                </span>
              )}
              {!contact.is_active && (
                <span className="rounded bg-bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Inactive
                </span>
              )}
            </h1>
            {contact.title && <p className="text-sm text-fg-muted">{contact.title}</p>}
          </header>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-border bg-bg p-4 sm:grid-cols-2">
            <Field label="Email">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-brand hover:underline">
                  {contact.email}
                </a>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Phone">
              {contact.phone ? (
                <a href={`tel:${contact.phone}`} className="text-brand hover:underline">
                  {contact.phone}
                </a>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Customer">
              <Link
                to={`/crm/customers/${contact.customer_id}`}
                className="text-brand hover:underline"
              >
                View customer →
              </Link>
            </Field>
            <Field label="Created">
              <time dateTime={contact.created_at}>
                {new Date(contact.created_at).toLocaleDateString()}
              </time>
            </Field>
          </dl>

          {/* Phase 16 (Wave 10 Session 2) — R-W10-S2-B1-OBS-02 wires the
              CollaborationSection into the contact detail page. */}
          <CollaborationSection entityType="contact" entityId={contact.id} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
