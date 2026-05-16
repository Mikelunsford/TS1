/**
 * VendorBillFormPage — Create or edit a vendor bill. Header-only per
 * D-W7-6. Uses <VendorBillForm> for the actual form body.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import {
  VendorBillForm,
  emptyVendorBillForm,
  fromVendorBill,
} from '@/components/procurement/VendorBillForm';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { vendorBillKeys } from '@/lib/queryKeys/vendorBills';
import {
  createVendorBill,
  getVendorBill,
  updateVendorBill,
} from '@/lib/services/vendorBillsService';
import type { VendorBillCreate, VendorBillPatch } from '@/lib/types';

export default function VendorBillFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: id ? vendorBillKeys.detail(id) : ['vendor-bill', 'new'],
    queryFn: () => getVendorBill(id!),
    enabled: isEdit,
  });

  const createMutation = useMutation({
    mutationFn: (body: VendorBillCreate) => createVendorBill(body),
    onSuccess: (data) => {
      toast.success(`Bill ${data.bill_number} created`);
      void qc.invalidateQueries({ queryKey: vendorBillKeys.all });
      navigate(`/vendor-bills/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: VendorBillPatch) => updateVendorBill(id!, body),
    onSuccess: (data) => {
      toast.success('Bill updated');
      void qc.invalidateQueries({ queryKey: vendorBillKeys.detail(data.id) });
      void qc.invalidateQueries({ queryKey: vendorBillKeys.all });
      navigate(`/vendor-bills/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  function onSubmit(parsed: VendorBillCreate) {
    if (isEdit) {
      // Strip vendor_id on PATCH (not in patch schema).
      const { vendor_id: _unused, ...rest } = parsed;
      void _unused;
      patchMutation.mutate(rest as VendorBillPatch);
    } else {
      createMutation.mutate(parsed);
    }
  }

  const submitting = createMutation.isPending || patchMutation.isPending;
  const initial =
    isEdit && existing.data ? fromVendorBill(existing.data) : emptyVendorBillForm();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/vendor-bills" className="hover:underline">
          Vendor bills
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{isEdit ? existing.data?.bill_number ?? '…' : 'New'}</span>
      </nav>

      <h1 className="text-2xl font-semibold">
        {isEdit ? 'Edit vendor bill' : 'New vendor bill'}
      </h1>

      {existing.isLoading && <Skeleton className="h-64 w-full" />}
      {existing.error && (
        <ErrorState title="Could not load vendor bill" error={existing.error} />
      )}

      {(!isEdit || existing.data) && (
        <VendorBillForm
          initial={initial}
          submitting={submitting}
          onSubmit={onSubmit}
          submitLabel={isEdit ? 'Save' : 'Create vendor bill'}
          cancelHref={isEdit ? `/vendor-bills/${id}` : '/vendor-bills'}
        />
      )}
    </div>
  );
}
