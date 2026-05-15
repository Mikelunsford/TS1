/**
 * QuoteLineEditor — inline line-item editor for a draft quote. Surfaces:
 *
 *  - Add line via the existing item picker (pre-fills description, unit price,
 *    unit, tax id).
 *  - Edit description, quantity, discount in-row.
 *  - Delete line.
 *  - Reorder via `@dnd-kit/sortable` drag handle.
 *
 * Mutation strategy: append / patch / delete / reorder route through the
 * granular endpoints (cheaper round-trips for typical edits). The bulk
 * `replaceQuoteLines` is reserved for future cases (e.g., "import from CSV");
 * we ship without invoking it here. The handler recomputes parent totals
 * on every line mutation, so the detail page re-fetches the quote header
 * after each onSuccess.
 *
 * Only rendered when the parent quote is `status='draft'`.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { quoteKeys } from '@/lib/queryKeys/quotes';
import { itemKeys } from '@/lib/queryKeys/inventory';
import { listItems } from '@/lib/services/itemsService';
import {
  appendQuoteLine,
  deleteQuoteLine,
  listQuoteLines,
  patchQuoteLine,
  reorderQuoteLines,
} from '@/lib/services/quoteLineItemsService';
import type { QuoteLine } from '@/lib/types';

function asNumber(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

interface Props {
  quoteId: string;
  currency: string;
  /** Whether the editor accepts mutations. Pass false to render read-only. */
  editable: boolean;
}

export function QuoteLineEditor({ quoteId, currency, editable }: Props) {
  const qc = useQueryClient();

  const linesQuery = useQuery({
    queryKey: quoteKeys.lines(quoteId),
    queryFn: () => listQuoteLines(quoteId),
    staleTime: 10_000,
  });

  const lines: QuoteLine[] = linesQuery.data?.items ?? [];

  function invalidate() {
    void qc.invalidateQueries({ queryKey: quoteKeys.lines(quoteId) });
    void qc.invalidateQueries({ queryKey: quoteKeys.detail(quoteId) });
  }

  const appendMutation = useMutation({
    mutationFn: (vars: Parameters<typeof appendQuoteLine>[1]) => appendQuoteLine(quoteId, vars),
    onSuccess: () => {
      toast.success('Line added');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Add failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { lineId: string; body: Parameters<typeof patchQuoteLine>[2] }) =>
      patchQuoteLine(quoteId, vars.lineId, vars.body),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (lineId: string) => deleteQuoteLine(quoteId, lineId),
    onSuccess: () => {
      toast.success('Line removed');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Delete failed'),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderQuoteLines(quoteId, { line_ids: ids }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Reorder failed'),
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = lines.map((l) => l.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    reorderMutation.mutate(next);
  }

  return (
    <section
      aria-labelledby="quote-lines-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <h2 id="quote-lines-heading" className="text-lg font-semibold">
        Line items
      </h2>

      {linesQuery.isLoading && <p className="text-sm text-fg-muted">Loading lines…</p>}

      {lines.length === 0 && !linesQuery.isLoading && (
        <p className="text-sm text-fg-muted">No lines yet.</p>
      )}

      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th scope="col" className="w-6 px-2 py-2" aria-label="Drag handle" />
                    <th scope="col" className="px-3 py-2 font-medium">
                      Description
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Qty
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Unit
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Unit price
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Discount
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Tax
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Line total
                    </th>
                    {editable && (
                      <th scope="col" className="w-12 px-2 py-2" aria-label="Actions" />
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line) => (
                    <SortableRow
                      key={line.id}
                      line={line}
                      currency={currency}
                      editable={editable}
                      onPatch={(body) =>
                        patchMutation.mutate({ lineId: line.id, body })
                      }
                      onDelete={() => deleteMutation.mutate(line.id)}
                    />
                  ))}
                </tbody>
              </table>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {editable && (
        <AddLineForm
          currency={currency}
          nextPosition={lines.length}
          onSubmit={(body) => appendMutation.mutate(body)}
          pending={appendMutation.isPending}
        />
      )}
    </section>
  );
}

function SortableRow({
  line,
  currency,
  editable,
  onPatch,
  onDelete,
}: {
  line: QuoteLine;
  currency: string;
  editable: boolean;
  onPatch: (body: Parameters<typeof patchQuoteLine>[2]) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const [description, setDescription] = useState(line.description);
  const [quantity, setQuantity] = useState(String(asNumber(line.quantity)));
  const [unitPrice, setUnitPrice] = useState<number>(asNumber(line.unit_price_cents));
  const [discount, setDiscount] = useState<number>(asNumber(line.discount_cents));

  function commit(field: 'description' | 'quantity' | 'unit_price_cents' | 'discount_cents') {
    if (!editable) return;
    if (field === 'description' && description !== line.description) {
      onPatch({ description });
    } else if (field === 'quantity') {
      const n = Number(quantity);
      if (Number.isFinite(n) && n > 0 && n !== asNumber(line.quantity)) {
        onPatch({ quantity: n });
      }
    } else if (field === 'unit_price_cents' && unitPrice !== asNumber(line.unit_price_cents)) {
      onPatch({ unit_price_cents: unitPrice });
    } else if (field === 'discount_cents' && discount !== asNumber(line.discount_cents)) {
      onPatch({ discount_cents: discount });
    }
  }

  return (
    <tr ref={setNodeRef} style={style} className="hover:bg-bg-muted">
      <td className="px-2 py-2 text-fg-subtle">
        {editable ? (
          <button
            type="button"
            className="cursor-grab touch-none"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {editable ? (
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => commit('description')}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : (
          line.description
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {editable ? (
          <input
            type="number"
            min={0}
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => commit('quantity')}
            className="w-20 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : (
          <span className="font-mono">{asNumber(line.quantity)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-fg-muted">{line.unit ?? '—'}</td>
      <td className="px-3 py-2 text-right">
        {editable ? (
          <MoneyInput
            value={unitPrice}
            onChange={(c) => {
              setUnitPrice(c);
              if (c !== asNumber(line.unit_price_cents)) {
                onPatch({ unit_price_cents: c });
              }
            }}
            currency={currency}
          />
        ) : (
          <MoneyDisplay cents={line.unit_price_cents} currency={currency} />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {editable ? (
          <MoneyInput
            value={discount}
            onChange={(c) => {
              setDiscount(c);
              if (c !== asNumber(line.discount_cents)) {
                onPatch({ discount_cents: c });
              }
            }}
            currency={currency}
          />
        ) : (
          <MoneyDisplay cents={line.discount_cents} currency={currency} />
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-fg-muted">
        <MoneyDisplay cents={line.tax_amount_cents} currency={currency} />
      </td>
      <td className="px-3 py-2 text-right font-mono">
        <MoneyDisplay cents={line.line_total_cents} currency={currency} />
      </td>
      {editable && (
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete line"
            className="rounded-md p-1 text-fg-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      )}
    </tr>
  );
}

interface AddLineFormState {
  item_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price_cents: number;
  discount_cents: number;
}

function emptyAddForm(): AddLineFormState {
  return {
    item_id: null,
    description: '',
    quantity: '1',
    unit: '',
    unit_price_cents: 0,
    discount_cents: 0,
  };
}

function AddLineForm({
  currency,
  nextPosition,
  onSubmit,
  pending,
}: {
  currency: string;
  nextPosition: number;
  onSubmit: (body: Parameters<typeof appendQuoteLine>[1]) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState<AddLineFormState>(emptyAddForm());
  const [pickerSearch, setPickerSearch] = useState('');

  const itemsQuery = useQuery({
    queryKey: [...itemKeys.list(), { q: pickerSearch, is_active: true }],
    queryFn: () =>
      listItems(pickerSearch ? { q: pickerSearch, is_active: true } : { is_active: true }),
    staleTime: 30_000,
  });

  const items = itemsQuery.data?.items ?? [];

  function handleItemPick(id: string) {
    const item = items.find((it) => it.id === id);
    if (!item) {
      setForm({ ...form, item_id: null });
      return;
    }
    setForm({
      ...form,
      item_id: item.id,
      description: item.description,
      unit_price_cents: Number(item.unit_price_cents),
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Quantity must be positive');
      return;
    }
    if (form.description.trim() === '') {
      toast.error('Description is required');
      return;
    }
    onSubmit({
      item_id: form.item_id,
      description: form.description,
      quantity: qty,
      unit: form.unit.trim() === '' ? null : form.unit,
      unit_price_cents: form.unit_price_cents,
      unit_cost_cents: 0,
      discount_cents: form.discount_cents,
      position: nextPosition,
    });
    setForm(emptyAddForm());
    setPickerSearch('');
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-2 rounded-md border border-dashed border-border bg-bg-muted p-3 text-sm sm:grid-cols-6"
      aria-label="Add line"
    >
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="add-line-item" className="text-xs uppercase tracking-wide text-fg-subtle">
          Item
        </label>
        <input
          id="add-line-item-search"
          type="search"
          placeholder="Search items…"
          value={pickerSearch}
          onChange={(e) => setPickerSearch(e.target.value)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <select
          id="add-line-item"
          value={form.item_id ?? ''}
          onChange={(e) => handleItemPick(e.target.value)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="">(custom line)</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.item_code} — {it.description}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="add-line-desc" className="text-xs uppercase tracking-wide text-fg-subtle">
          Description
        </label>
        <input
          id="add-line-desc"
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="add-line-qty" className="text-xs uppercase tracking-wide text-fg-subtle">
          Qty
        </label>
        <input
          id="add-line-qty"
          type="number"
          min={0}
          step="0.01"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          className="rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="add-line-unit" className="text-xs uppercase tracking-wide text-fg-subtle">
          Unit
        </label>
        <input
          id="add-line-unit"
          type="text"
          maxLength={40}
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value })}
          placeholder="ea, hr, lb"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="add-line-price"
          className="text-xs uppercase tracking-wide text-fg-subtle"
        >
          Unit price
        </label>
        <MoneyInput
          id="add-line-price"
          value={form.unit_price_cents}
          onChange={(c) => setForm({ ...form, unit_price_cents: c })}
          currency={currency}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="add-line-discount"
          className="text-xs uppercase tracking-wide text-fg-subtle"
        >
          Discount
        </label>
        <MoneyInput
          id="add-line-discount"
          value={form.discount_cents}
          onChange={(c) => setForm({ ...form, discount_cents: c })}
          currency={currency}
        />
      </div>
      <div className="flex items-end sm:col-span-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          data-testid="add-line-submit"
        >
          {pending ? 'Adding…' : 'Add line'}
        </button>
      </div>
    </form>
  );
}
