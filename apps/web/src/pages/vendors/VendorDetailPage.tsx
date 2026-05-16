/**
 * VendorDetailPage — header + summary fields + archive action. POs and
 * vendor bills associated with the vendor are surfaced as related-link
 * shortcuts (clicking jumps to the list pre-filtered by vendor_id).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { vendorKeys } from '@/lib/queryKeys/vendors';
import { archiveVendor, getVendor } from '@/lib/services/vendorsService';

export default function VendorDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();

  const query = useQuery({
    queryKey: vendorKeys.detail(id),
    queryFn: () => getVendor(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveVendor(id),
    onSuccess: () => {
      toast.success('Vendor archived');
      void qc.invalidateQueries({ queryKey: vendorKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: vendorKeys.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Archive failed'),
  });

  const vendor = query.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/vendors" className="hover:underline">
          Vendors
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{vendor?.name ?? '…'}</span>
      </nav>

      {query.isLoading && <Skeleton className="h-32 w-full" />}
      {query.error && <ErrorState title="Could not load vendor" error={query.error} />}

      {vendor && (
        <>
          <section className="space-y-3 rounded-md border border-border bg-bg p-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold" data-testid="vendor-name-h1">
                  {vendor.name}
                </h1>
                {vendor.legal_name && (
                  <p className="text-sm text-fg-muted">{vendor.legal_name}</p>
                )}
              </div>
              <div className="flex gap-2">
                {can('vendors.write') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/vendors/${vendor.id}/edit`)}
                    className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                    data-testid="vendor-edit"
                  >
                    Edit
                  </button>
                )}
                {can('vendors.write') && vendor.is_active && (
                  <button
                    type="button"
                    onClick={() => archiveMutation.mutate()}
                    disabled={archiveMutation.isPending}
                    className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
                    data-testid="vendor-archive"
                  >
                    {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
                  </button>
                )}
              </div>
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Email</dt>
                <dd className="text-fg">{vendor.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Phone</dt>
                <dd className="text-fg">{vendor.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Website</dt>
                <dd className="text-fg">
                  {vendor.website ? (
                    <a className="text-brand hover:underline" href={vendor.website} target="_blank" rel="noreferrer">
                      {vendor.website}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Tax ID</dt>
                <dd className="text-fg">{vendor.tax_id ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{vendor.currency_code ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Payment terms</dt>
                <dd className="font-mono text-fg">{vendor.payment_terms_days} days</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">External ref</dt>
                <dd className="text-fg">{vendor.external_ref ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Added</dt>
                <dd className="text-fg">{formatDate(vendor.created_at)}</dd>
              </div>
            </dl>

            {vendor.notes && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Notes</dt>
                <dd className="whitespace-pre-line text-sm text-fg">{vendor.notes}</dd>
              </div>
            )}
          </section>

          <section
            aria-label="Related"
            className="grid gap-3 sm:grid-cols-2"
            data-testid="vendor-related"
          >
            <Link
              to={`/purchase-orders?vendor_id=${vendor.id}`}
              className="rounded-md border border-border bg-bg p-4 hover:bg-bg-muted"
            >
              <p className="text-sm font-medium text-fg">Purchase orders</p>
              <p className="text-xs text-fg-muted">View POs for this vendor</p>
            </Link>
            <Link
              to={`/vendor-bills?vendor_id=${vendor.id}`}
              className="rounded-md border border-border bg-bg p-4 hover:bg-bg-muted"
            >
              <p className="text-sm font-medium text-fg">Vendor bills</p>
              <p className="text-xs text-fg-muted">View bills for this vendor</p>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
