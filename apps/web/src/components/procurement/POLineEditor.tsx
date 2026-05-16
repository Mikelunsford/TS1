/**
 * POLineEditor — line-item editor for a draft purchase order. Mirrors
 * `InvoiceLineEditor` but routes through `poLineItemsService` and uses
 * `unit_cost_cents` (cost-side, not customer-facing pricing).
 *
 * Constitutional invariant (F-Wave5-02):
 *   line_total_cents = roundHalfEven(quantity * unit_cost_cents)
 * The BE trigger does NOT recompute line totals — only PO header rollups.
 * SPA computes a local preview so users see the running line total before
 * the round-trip; BE persists the exact same value.
 *
 * No reorder endpoint exists in the BE today (POST /lines, PATCH /lines/:id,
 * DELETE /lines/:id only). The drag handles re-emit each row's `position`
 * via patch, which the BE trigger picks up on AIUD.
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { roundHalfEven } from '@/lib/money';
import { poLineItemKeys } from '@/lib/queryKeys/poLineItems';
import { purchaseOrderKeys } from '@/lib/queryKeys/purchaseOrders';
import {
  addPOLineItem,
  deletePOLineItem,
  patchPOLineItem,
} from '@/lib/services/poLineItemsService';
import type { POLineItem, POLineItemCreate, POLineItemPatch } from '@/lib/types';

function asNumber(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

/** Local preview matching the BE invariant. */
export function previewLineTotal(quantity: number, unitCostCents: number): number {
  return roundHalfEven(quantity * unitCostCents);
}

interface Props {
  poId: string;
  lines: POLineItem[];
  currency: string;
  editable: boolean;
  readOnlyReason?: string;
}

export function POLineEditor({ poId, lines, currency, editable, readOnlyReason }: Props) {
  const qc = useQueryClient();

  function invalidate() {
    void qc.invalidateQueries({ queryKey: purchaseOrderKeys.detail(poId) });
    void qc.invalidateQueries({ queryKey: poLineItemKeys.lines(poId) });
  }

  const appendMutation = useMutation({
    mutationFn: (body: POLineItemCreate) => addPOLineItem(poId, body),
    onSuccess: () => {
      toast.success('Line added');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Add failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { lineId: string; body: POLineItemPatch }) =>
      patchPOLineItem(poId, vars.lineId, vars.body),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (lineId: string) => deletePOLineItem(poId, lineId),
    onSuccess: () => {
      toast.success('Line removed');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Delete failed'),
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
    const nextOrder = arrayMove(lines, oldIdx, newIdx);
    // Optimistic position re-emit. The BE accepts `position` on PATCH.
    nextOrder.forEach((line, idx) => {
      if (line.position !== idx) {
        patchMutation.mutate({ lineId: line.id, body: { position: idx } });
      }
    });
  }

  // SPA-side subtotal preview matching the BE recompute trigger output.
  const subtotalPreview = lines.reduce(
    (acc, l) => acc + previewLineTotal(asNumber(l.quantity), asNumber(l.unit_cost_cents)),
    0,
  );

  return (
    <section
      aria-labelledby="po-lines-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <h2 id="po-lines-heading" className="text-lg font-semibold">
        Line items
      </h2>

      {lines.length === 0 && (
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
                    <th scope="col" className="px-3 py-2 font-medium">Description</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
                    <th scope="col" className="px-3 py-2 font-medium">Unit</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Line total</th>
                    {editable && <th scope="col" className="w-12 px-2 py-2" aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line) => (
                    <SortableRow
                      key={line.id}
                      line={line}
                      currency={currency}
                      editable={editable}
                      onPatch={(body) => patchMutation.mutate({ lineId: line.id, body })}
                      onDelete={() => deleteMutation.mutate(line.id)}
                    />
                  ))}
                </tbody>
              </table>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {lines.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-end gap-4 border-t border-border pt-2 text-xs text-fg-muted"
          data-testid="po-line-totals-preview"
        >
          <span>
            Subtotal preview:{' '}
            <span className="font-mono text-fg">
              <MoneyDisplay cents={subtotalPreview} currency={currency} />
            </span>
          </span>
        </div>
      )}

      {editable ? (
        <AddPOLineForm
          currency={currency}
          nextPosition={lines.length}
          onSubmit={(body) => appendMutation.mutate(body)}
          pending={appendMutation.isPending}
        />
      ) : (
        <p className="text-xs italic text-fg-subtle">
          {readOnlyReason ?? 'Lines are locked once the PO leaves draft.'}
        </p>
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
  line: POLineItem;
  currency: string;
  editable: boolean;
  onPatch: (body: POLineItemPatch) => void;
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
  const [unitCost, setUnitCost] = useState<number>(asNumber(line.unit_cost_cents));

  function commit(field: 'description' | 'quantity' | 'unit_cost_cents') {
    if (!editable) return;
    if (field === 'description' && description !== line.description) {
      onPatch({ description });
    } else if (field === 'quantity') {
      const n = Number(quantity);
      if (Number.isFinite(n) && n > 0 && n !== asNumber(line.quantity)) {
        onPatch({ quantity: n });
      }
    } else if (field === 'unit_cost_cents' && unitCost !== asNumber(line.unit_cost_cents)) {
      onPatch({ unit_cost_cents: unitCost });
    }
  }

  const livePreview = previewLineTotal(Number(quantity) || 0, unitCost);

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
            step="0.0001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => commit('quantity')}
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : (
          <span className="font-mono">{asNumber(line.quantity)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-fg-muted">
        {asNumber(line.quantity_received)}
      </td>
      <td className="px-3 py-2 text-fg-muted">{line.unit ?? '—'}</td>
      <td className="px-3 py-2 text-right">
        {editable ? (
          <MoneyInput
            value={unitCost}
            onChange={(c) => {
              setUnitCost(c);
              if (c !== asNumber(line.unit_cost_cents)) onPatch({ unit_cost_cents: c });
            }}
            currency={currency}
          />
        ) : (
          <MoneyDisplay cents={line.unit_cost_cents} currency={currency} />
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        <MoneyDisplay cents={editable ? livePreview : line.line_total_cents} currency={currency} />
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

interface AddFormState {
  description: string;
  quantity: string;
  unit: string;
  unit_cost_cents: number;
}

function emptyForm(): AddFormState {
  return { description: '', quantity: '1', unit: '', unit_cost_cents: 0 };
}

function AddPOLineForm({
  currency,
  nextPosition,
  onSubmit,
  pending,
}: {
  currency: string;
  nextPosition: number;
  onSubmit: (body: POLineItemCreate) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState<AddFormState>(emptyForm());

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
      description: form.description,
      quantity: qty,
      unit: form.unit.trim() === '' ? null : form.unit,
      unit_cost_cents: form.unit_cost_cents,
      position: nextPosition,
    });
    setForm(emptyForm());
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-2 rounded-md border border-dashed border-border bg-bg-muted p-3 text-sm sm:grid-cols-5"
      aria-label="Add PO line"
    >
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="po-add-desc" className="text-xs uppercase tracking-wide text-fg-subtle">
          Description
        </label>
        <input
          id="po-add-desc"
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="po-add-qty" className="text-xs uppercase tracking-wide text-fg-subtle">
          Qty
        </label>
        <input
          id="po-add-qty"
          type="number"
          min={0}
          step="0.0001"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          className="rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="po-add-unit" className="text-xs uppercase tracking-wide text-fg-subtle">
          Unit
        </label>
        <input
          id="po-add-unit"
          type="text"
          maxLength={32}
          value={form.unit}
          onChange={(e) => setForm({ ...form, unit: e.target.value })}
          placeholder="ea, hr, lb"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="po-add-cost" className="text-xs uppercase tracking-wide text-fg-subtle">
          Unit cost
        </label>
        <MoneyInput
          id="po-add-cost"
          value={form.unit_cost_cents}
          onChange={(c) => setForm({ ...form, unit_cost_cents: c })}
          currency={currency}
        />
      </div>
      <div className="flex items-end sm:col-span-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          data-testid="po-add-line-submit"
        >
          {pending ? 'Adding…' : 'Add line'}
        </button>
      </div>
    </form>
  );
}
