import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { CurrencyPicker } from '@/components/inventory/CurrencyPicker';
import { ItemCategoryPicker } from '@/components/inventory/ItemCategoryPicker';
import { TaxPicker } from '@/components/inventory/TaxPicker';
import { UnitPicker } from '@/components/inventory/UnitPicker';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Skeleton } from '@/components/ui/Skeleton';
import { itemKeys } from '@/lib/queryKeys/inventory';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import {
  archiveItem,
  getItem,
  updateItem,
} from '@/lib/services/itemsService';
import {
  ItemKindSchema,
  ItemPatchSchema,
  type Item,
  type ItemPatch,
} from '@/lib/types';

type FormState = {
  description: string;
  item_code: string;
  item_kind: Item['item_kind'];
  category_id: string | null;
  unit_id: string | null;
  tax_id: string | null;
  currency_code: string | null;
  unit_price_cents: number;
  unit_cost_cents: number;
  is_inventoried: boolean;
  reorder_point: number | null;
};

function toForm(item: Item): FormState {
  const price = typeof item.unit_price_cents === 'string'
    ? Number(item.unit_price_cents)
    : Number(item.unit_price_cents);
  const cost = typeof item.unit_cost_cents === 'string'
    ? Number(item.unit_cost_cents)
    : Number(item.unit_cost_cents);
  const reorder = item.reorder_point === null
    ? null
    : typeof item.reorder_point === 'string'
      ? Number(item.reorder_point)
      : item.reorder_point;
  return {
    description: item.description,
    item_code: item.item_code,
    item_kind: item.item_kind,
    category_id: item.category_id,
    unit_id: item.unit_id,
    tax_id: item.tax_id,
    currency_code: item.currency_code,
    unit_price_cents: Number.isFinite(price) ? price : 0,
    unit_cost_cents: Number.isFinite(cost) ? cost : 0,
    is_inventoried: item.is_inventoried,
    reorder_point: reorder !== null && Number.isFinite(reorder) ? reorder : null,
  };
}

/**
 * Item detail / edit. Bare useState + Zod safeParse at submit per the R-01
 * reconcile. Money fields go through MoneyInput which holds cents. Patch body
 * is validated against ItemPatchSchema before the network call.
 */
export default function ItemDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const itemQuery = useQuery({
    queryKey: itemKeys.detail(id),
    queryFn: () => getItem(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  // Hydrate form once data lands. We deliberately only re-hydrate on item id
  // change so edits don't get clobbered by a background refetch.
  useEffect(() => {
    if (itemQuery.data && !form) {
      setForm(toForm(itemQuery.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemQuery.data?.id]);

  const updateMutation = useMutation({
    mutationFn: (body: ItemPatch) => updateItem(id, body),
    onSuccess: (data) => {
      qc.setQueryData(itemKeys.detail(id), data);
      qc.invalidateQueries({ queryKey: itemKeys.all });
      toast.success('Item saved');
      setForm(toForm(data));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveItem(id),
    onSuccess: (data) => {
      qc.setQueryData(itemKeys.detail(id), data);
      qc.invalidateQueries({ queryKey: itemKeys.all });
      toast.success('Item archived');
      setForm(toForm(data));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Archive failed');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const body: ItemPatch = {
      item_code: form.item_code,
      description: form.description,
      item_kind: form.item_kind,
      category_id: form.category_id,
      unit_id: form.unit_id,
      tax_id: form.tax_id,
      currency_code: form.currency_code,
      unit_price_cents: form.unit_price_cents,
      unit_cost_cents: form.unit_cost_cents,
      is_inventoried: form.is_inventoried,
      reorder_point: form.reorder_point,
    };
    const parsed = ItemPatchSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setErrors({});
    updateMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/items" className="hover:underline">
          Items
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{itemQuery.data?.item_code ?? '…'}</span>
      </nav>

      {itemQuery.isLoading && <Skeleton className="h-40 w-full" />}
      {itemQuery.error && (
        <ErrorState title="Could not load item" error={itemQuery.error} />
      )}

      {itemQuery.data && form && (
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-md border border-border bg-bg p-4"
        >
          <header className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{itemQuery.data.description}</h1>
            {itemQuery.data.is_active ? (
              <Badge tone="success">Active</Badge>
            ) : (
              <Badge tone="neutral">Archived</Badge>
            )}
            <Badge>{itemQuery.data.item_kind}</Badge>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={errors['description']}>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
            <Field label="SKU / Item code" error={errors['item_code']}>
              <input
                type="text"
                value={form.item_code}
                onChange={(e) => setForm({ ...form, item_code: e.target.value })}
                className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
            <Field label="Kind" error={errors['item_kind']}>
              <select
                value={form.item_kind}
                onChange={(e) =>
                  setForm({ ...form, item_kind: e.target.value as Item['item_kind'] })
                }
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {ItemKindSchema.options.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category" error={errors['category_id']}>
              <ItemCategoryPicker
                value={form.category_id}
                onChange={(v) => setForm({ ...form, category_id: v })}
                className="w-full"
              />
            </Field>
            <Field label="Unit" error={errors['unit_id']}>
              <UnitPicker
                value={form.unit_id}
                onChange={(v) => setForm({ ...form, unit_id: v })}
                className="w-full"
              />
            </Field>
            <Field label="Tax" error={errors['tax_id']}>
              <TaxPicker
                value={form.tax_id}
                onChange={(v) => setForm({ ...form, tax_id: v })}
                className="w-full"
              />
            </Field>
            <Field label="Currency" error={errors['currency_code']}>
              <CurrencyPicker
                value={form.currency_code}
                onChange={(v) => setForm({ ...form, currency_code: v })}
                className="w-full"
                includeNone
              />
            </Field>
            <Field label="Default price" error={errors['unit_price_cents']}>
              <MoneyInput
                value={form.unit_price_cents}
                onChange={(cents) => setForm({ ...form, unit_price_cents: cents })}
                currency={form.currency_code ?? 'USD'}
                className="w-full"
              />
            </Field>
            <Field label="Default cost" error={errors['unit_cost_cents']}>
              <MoneyInput
                value={form.unit_cost_cents}
                onChange={(cents) => setForm({ ...form, unit_cost_cents: cents })}
                currency={form.currency_code ?? 'USD'}
                className="w-full"
              />
            </Field>
            <Field label="Reorder point" error={errors['reorder_point']}>
              <input
                type="number"
                min={0}
                step={1}
                value={form.reorder_point ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    reorder_point: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
              <input
                type="checkbox"
                checked={form.is_inventoried}
                onChange={(e) => setForm({ ...form, is_inventoried: e.target.checked })}
                className="rounded border-border"
              />
              Tracked in inventory
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => archiveMutation.mutate()}
              disabled={!itemQuery.data.is_active || archiveMutation.isPending}
              className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
            >
              {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="item" entityId={id} idPrefix="item-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error: string[] | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-fg-subtle">{label}</span>
      {children}
      {error && error.length > 0 && (
        <span className="text-xs text-danger">{error.join(', ')}</span>
      )}
    </label>
  );
}
