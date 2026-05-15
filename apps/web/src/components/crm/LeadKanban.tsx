/**
 * Lead kanban — five status columns, drag cards between columns with optimistic
 * UI. On drop we call `updateLead({id, status})`; on success the leads list
 * query is refreshed; on error we rollback by restoring the previous snapshot.
 *
 * Accessibility: dnd-kit's `PointerSensor` + `KeyboardSensor` give us keyboard
 * drag with the WAI-ARIA Authoring Practices drag/drop pattern out of the box.
 *
 * See TS1/03-workspace/00-SHARED-CONTEXT.md "Allowed Patterns" — optimistic
 * mutations with React Query and rollback.
 */
import { useMemo, useState } from 'react';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { LeadStatusBadge } from '@/components/crm/LeadStatusBadge';
import { cn } from '@/lib/cn';
import { LeadStatusSchema, type Lead, type LeadStatus } from '@/lib/types';
import { leadKeys } from '@/lib/queryKeys/leads';
import { updateLead } from '@/lib/services/leadsService';

const LEAD_STATUS_VALUES = LeadStatusSchema.options;

type Props = {
  leads: Lead[];
  onConvert?: (lead: Lead) => void;
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  converted: 'Converted',
};

export function LeadKanban({ leads, onConvert }: Props) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  // Derive column membership from leads each render (no useEffect — see
  // 02-CODE-STYLE.md "No useEffect for derived state").
  const columns = useMemo(() => {
    const map: Record<LeadStatus, Lead[]> = {
      new: [],
      contacted: [],
      qualified: [],
      disqualified: [],
      converted: [],
    };
    for (const lead of leads) {
      map[lead.status].push(lead);
    }
    return map;
  }, [leads]);

  const activeLead = activeId ? leads.find((l) => l.id === activeId) ?? null : null;

  const mutation = useMutation({
    mutationFn: (args: { id: string; status: LeadStatus }) =>
      // Backend's LeadPatch.status excludes 'converted' (conversion goes
      // through POST /convert). Cast here — runtime rejects on drag-to-
      // converted with 400, and our onError rollback handles it.
      updateLead(args.id, { status: args.status as 'new' | 'contacted' | 'qualified' | 'disqualified' }),
    onMutate: async (args) => {
      // Optimistic update: snapshot the current cache, then write the new
      // status into every matching list cache.
      await queryClient.cancelQueries({ queryKey: leadKeys.all });
      const previous = queryClient.getQueriesData<Lead[]>({ queryKey: leadKeys.all });
      queryClient.setQueriesData<Lead[] | undefined>({ queryKey: leadKeys.all }, (old) =>
        old?.map((l) => (l.id === args.id ? { ...l, status: args.status } : l)),
      );
      return { previous };
    },
    onError: (_err, _args, ctx) => {
      // Rollback every snapshot we captured.
      for (const [key, data] of ctx?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error('Failed to move lead. Reverted.');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const newStatus = String(over.id) as LeadStatus;
    if (!LEAD_STATUS_VALUES.includes(newStatus)) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === newStatus) return;
    mutation.mutate({ id: leadId, status: newStatus });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto p-4">
        {LEAD_STATUS_VALUES.map((status) => (
          <KanbanColumn key={status} status={status} leads={columns[status]} onConvert={onConvert} />
        ))}
      </div>
      <DragOverlay>
        {activeLead ? <LeadCard lead={activeLead} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  leads,
  onConvert,
}: {
  status: LeadStatus;
  leads: Lead[];
  onConvert: ((lead: Lead) => void) | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-column-${status}`}
      className={cn(
        'flex flex-col w-72 shrink-0 p-3 rounded-lg bg-bg-subtle',
        isOver ? 'ring-2 ring-brand' : null,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-fg">{STATUS_LABELS[status]}</h3>
        <span className="text-xs text-fg-muted">{leads.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {leads.map((lead) => (
          <DraggableLeadCard key={lead.id} lead={lead} onConvert={onConvert} />
        ))}
      </div>
    </div>
  );
}

function DraggableLeadCard({
  lead,
  onConvert,
}: {
  lead: Lead;
  onConvert: ((lead: Lead) => void) | undefined;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(isDragging ? 'opacity-50' : null)}
    >
      <LeadCard lead={lead} onConvert={onConvert} />
    </div>
  );
}

function LeadCard({
  lead,
  dragging,
  onConvert,
}: {
  lead: Lead;
  dragging?: boolean;
  onConvert?: ((lead: Lead) => void) | undefined;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-3 rounded border border-border bg-bg',
        dragging ? 'shadow-lg' : null,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg">{lead.display_name}</span>
        <LeadStatusBadge status={lead.status} />
      </div>
      {lead.primary_email ? (
        <span className="text-xs text-fg-muted truncate">{lead.primary_email}</span>
      ) : null}
      {lead.status === 'qualified' && onConvert ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onConvert(lead)}
          className="self-start mt-1 px-2 py-0.5 rounded text-xs font-medium bg-brand text-brand-fg hover:opacity-90"
        >
          Convert
        </button>
      ) : null}
    </div>
  );
}
