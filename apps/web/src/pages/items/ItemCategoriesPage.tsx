import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { CategoryTree } from '@/components/inventory/CategoryTree';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { itemCategoryKeys } from '@/lib/queryKeys/inventory';
import {
  createItemCategory,
  deleteItemCategory,
  listItemCategories,
  updateItemCategory,
} from '@/lib/services/itemCategoriesService';
import {
  ItemCategoryCreateSchema,
  type ItemCategory,
  type ItemCategoryCreate,
} from '@/lib/types';

/**
 * Item categories — flat list editor on the right, tree preview on the left.
 * The list endpoint returns a flat array; the SPA composes the tree client-side
 * (CategoryTree handles the recursion + cycle guard).
 */
export default function ItemCategoriesPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: itemCategoryKeys.list(),
    queryFn: () => listItemCategories(),
    staleTime: 30_000,
  });

  const categories = useMemo<ItemCategory[]>(() => query.data?.items ?? [], [query.data]);

  const [form, setForm] = useState<ItemCategoryCreate>({
    code: '',
    label: '',
    parent_id: null,
    is_active: true,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const createMutation = useMutation({
    mutationFn: (body: ItemCategoryCreate) => createItemCategory(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: itemCategoryKeys.all });
      toast.success('Category added');
      setForm({ code: '', label: '', parent_id: null, is_active: true });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (c: ItemCategory) =>
      updateItemCategory(c.id, { is_active: !c.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemCategoryKeys.all }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItemCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: itemCategoryKeys.all });
      toast.success('Category deleted');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Delete failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ItemCategoryCreateSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/items" className="hover:underline">
          Items
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">Categories</span>
      </nav>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Item Categories</h1>
        <p className="text-sm text-fg-muted">
          Group items into a hierarchy. The list is flat; nesting is purely visual.
        </p>
      </header>

      {query.isLoading && <Skeleton className="h-40 w-full" />}
      {query.error && <ErrorState title="Could not load categories" error={query.error} />}

      {query.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <section
            aria-labelledby="cat-tree-heading"
            className="rounded-md border border-border bg-bg p-3"
          >
            <h2 id="cat-tree-heading" className="mb-2 text-sm font-medium text-fg">
              Tree
            </h2>
            {categories.length === 0 ? (
              <EmptyState
                title="No categories"
                description="Add your first category on the right."
              />
            ) : (
              <CategoryTree
                categories={categories}
                defaultExpandedIds={new Set(categories.map((c) => c.id))}
              />
            )}
          </section>

          <section
            aria-labelledby="cat-add-heading"
            className="rounded-md border border-border bg-bg p-3"
          >
            <h2 id="cat-add-heading" className="mb-2 text-sm font-medium text-fg">
              Add category
            </h2>
            <form onSubmit={onSubmit} className="space-y-2">
              <Field label="Code" error={errors['code']}>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </Field>
              <Field label="Label" error={errors['label']}>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </Field>
              <Field label="Parent" error={errors['parent_id']}>
                <select
                  value={form.parent_id ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, parent_id: e.target.value === '' ? null : e.target.value })
                  }
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="">— None (top-level) —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Adding…' : 'Add'}
              </button>
            </form>

            <hr className="my-3 border-border" />

            <h3 className="mb-2 text-sm font-medium text-fg">All categories</h3>
            {categories.length === 0 ? (
              <p className="text-sm text-fg-muted">None yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {categories.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1"
                  >
                    <span>
                      <span className="font-mono text-xs text-fg-subtle">{c.code}</span>{' '}
                      <span className="text-fg">{c.label}</span>
                      {!c.is_active && (
                        <span className="ml-2 text-xs uppercase tracking-wide text-fg-subtle">
                          (inactive)
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleActiveMutation.mutate(c)}
                        disabled={toggleActiveMutation.isPending}
                        className="rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg hover:bg-bg-muted disabled:opacity-50"
                      >
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete category "${c.label}"?`)) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="rounded border border-danger/40 bg-bg px-2 py-0.5 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
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
