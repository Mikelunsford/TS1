/**
 * Opportunity kanban — seven stage columns, drag cards between columns with
 * optimistic UI. Each column footer shows a weighted total: sum of
 * `amount_cents × probability_pct / 100`. The server-side audit trigger
 * (migration 0047) writes audit_log on every stage change — no client work.
 *
 * See TS1/09-api/00-API-CONTRACT.md §3.4 (opportunities).
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

import { OpportunityStageBadge } from '@/components/crm/OpportunityStageBadge';
import { cn } from '@/lib/cn';
import {
  OpportunityStageSchema,
  type Opportunity,
  type OpportunityStage,
} from '@/lib/types';
import { formatMoney } from '@/lib/money';
import { opportunityKeys } from '@/lib/queryKeys/opportunities';
import { updateOpportunityStage } from '@/lib/services/opportunitiesService';

const OPPORTUNITY_STAGE_VALUES = OpportunityStageSchema.options;

type Props = {
  opportunities: Opportunity[];
};

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospect: 'Prospect',
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  abandoned: 'Abandoned',
};

/**
 * Weighted total in cents = sum of (amount_cents * probability_pct / 100),
 * rounded half-even on the final cent (delegated to `formatMoney`'s
 * Intl formatter). Returns a Number; for very large pipelines the caller
 * may want to switch to bigint accumulation — flag for Wave 3.
 */
function weightedTotalCents(opps: Opportunity[]): number {
  let total = 0;
  for (const opp of opps) {
    const cents = opp.amount_cents;
    if (Number.isFinite(cents)) {
      total += (cents * opp.probability_pct) / 100;
    }
  }
  return Math.round(total);
}

export function OpportunityKanban({ opportunities }: Props) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const columns = useMemo(() => {
    const map: Record<OpportunityStage, Opportunity[]> = {
      prospect: [],
      discovery: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
      abandoned: [],
    };
    for (const opp of opportunities) {
      map[opp.stage].push(opp);
    }
    return map;
  }, [opportunities]);

  const activeOpp = activeId ? opportunities.find((o) => o.id === activeId) ?? null : null;

  const mutation = useMutation({
    mutationFn: (args: { id: string; stage: OpportunityStage }) =>
      updateOpportunityStage(args.id, { stage: args.stage }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: opportunityKeys.all });
      const previous = queryClient.getQueriesData<Opportunity[]>({
        queryKey: opportunityKeys.all,
      });
      queryClient.setQueriesData<Opportunity[] | undefined>(
        { queryKey: opportunityKeys.all },
        (old) => old?.map((o) => (o.id === args.id ? { ...o, stage: args.stage } : o)),
      );
      return { previous };
    },
    onError: (_err, _args, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error('Failed to move opportunity. Reverted.');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: opportunityKeys.all });
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const oppId = String(active.id);
    const newStage = String(over.id) as OpportunityStage;
    if (!OPPORTUNITY_STAGE_VALUES.includes(newStage)) return;
    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp || opp.stage === newStage) return;
    mutation.mutate({ id: oppId, stage: newStage });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto p-4">
        {OPPORTUNITY_STAGE_VALUES.map((stage) => {
          const stageOpps = columns[stage];
          const weighted = weightedTotalCents(stageOpps);
          const currency = stageOpps[0]?.currency_code ?? 'USD';
          return (
            <StageColumn
              key={stage}
              stage={stage}
              opportunities={stageOpps}
              weightedCents={weighted}
              currency={currency}
            />
          );
        })}
      </div>
      <DragOverlay>{activeOpp ? <OpportunityCard opp={activeOpp} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function StageColumn({
  stage,
  opportunities,
  weightedCents,
  currency,
}: {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  weightedCents: number;
  currency: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-column-${stage}`}
      className={cn(
        'flex flex-col w-72 shrink-0 p-3 rounded-lg bg-bg-subtle',
        isOver ? 'ring-2 ring-brand' : null,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-fg">{STAGE_LABELS[stage]}</h3>
        <span className="text-xs text-fg-muted">{opportunities.length}</span>
      </div>
      <div className="flex flex-col gap-2 mb-3 flex-1">
        {opportunities.map((opp) => (
          <DraggableOpportunityCard key={opp.id} opp={opp} />
        ))}
      </div>
      <div
        data-testid={`kanban-weighted-${stage}`}
        className="pt-2 border-t border-border text-xs text-fg-muted"
      >
        Weighted: <span className="font-medium text-fg">{formatMoney(weightedCents, { currency })}</span>
      </div>
    </div>
  );
}

function DraggableOpportunityCard({ opp }: { opp: Opportunity }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: opp.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(isDragging ? 'opacity-50' : null)}
    >
      <OpportunityCard opp={opp} />
    </div>
  );
}

function OpportunityCard({ opp, dragging }: { opp: Opportunity; dragging?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-3 rounded border border-border bg-bg',
        dragging ? 'shadow-lg' : null,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-fg truncate">{opp.display_name}</span>
        <OpportunityStageBadge stage={opp.stage} />
      </div>
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{formatMoney(opp.amount_cents, { currency: opp.currency_code ?? 'USD' })}</span>
        <span>{opp.probability_pct}%</span>
      </div>
      <span className="text-xs text-fg-subtle">{opp.opportunity_number}</span>
    </div>
  );
}
