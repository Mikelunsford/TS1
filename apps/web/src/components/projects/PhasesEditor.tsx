/**
 * PhasesEditor — inline editor for a project's phases. Renders each phase as
 * a row with status, name/description, planned/actual timestamps, budget,
 * and a drag handle. Supports:
 *
 *  - Add phase (name + position + optional planned dates / budget / notes)
 *  - Edit phase in-row (name, description, budget, dates)
 *  - Soft-delete phase (server stamps deleted_at)
 *  - Drag-reorder via @dnd-kit/sortable (PointerSensor + KeyboardSensor)
 *  - Phase status transitions (Start / Complete / Cancel), gated by
 *    `canTransition('phase', current, target)` so illegal jumps don't render
 *    a button.
 *
 * Mutations cap-gate the write affordances on `projects.write`.
 */
import { useState } from 'react';
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
import { toast } from 'sonner';

import { PhaseStatusBadge } from '@/components/projects/ProjectStatusBadge';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { can } from '@/lib/capabilities';
import { formatDate } from '@/lib/formatDate';
import { useActiveRole } from '@/lib/hooks/useActiveRole';
import { projectKeys } from '@/lib/queryKeys/projects';
import {
  createPhase,
  deletePhase,
  patchPhase,
  reorderPhases,
  updatePhaseStatus,
} from '@/lib/services/projectPhasesService';
import type {
  PhaseStatus,
  ProjectPhase,
  ProjectPhaseCreate,
  ProjectPhasePatch,
} from '@/lib/types';
import { canTransition } from '@/lib/workflow';

interface Props {
  projectId: string;
  phases: ProjectPhase[];
  currency: string;
}

function emptyDraft(nextPosition: number): ProjectPhaseCreate {
  return {
    name: '',
    description: null,
    position: nextPosition,
    planned_start_at: null,
    planned_end_at: null,
    budget_cents: 0,
    notes: null,
  };
}

export function PhasesEditor({ projectId, phases, currency }: Props) {
  const role = useActiveRole();
  const canWrite = can(role, 'projects.write');
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<ProjectPhaseCreate>(() =>
    emptyDraft(phases.length ? Math.max(...phases.map((p) => p.position)) + 1 : 0),
  );
  const [showAdd, setShowAdd] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.phases(projectId) });

  const createMutation = useMutation({
    mutationFn: (body: ProjectPhaseCreate) => createPhase(projectId, body),
    onSuccess: () => {
      toast.success('Phase added');
      setShowAdd(false);
      setDraft(
        emptyDraft(phases.length ? Math.max(...phases.map((p) => p.position)) + 2 : 1),
      );
      void invalidate();
    },
    onError: () => toast.error('Failed to add phase'),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { phaseId: string; patch: ProjectPhasePatch }) =>
      patchPhase(projectId, vars.phaseId, vars.patch),
    onSuccess: () => {
      toast.success('Phase saved');
      void invalidate();
    },
    onError: () => toast.error('Failed to save phase'),
  });

  const deleteMutation = useMutation({
    mutationFn: (phaseId: string) => deletePhase(projectId, phaseId),
    onSuccess: () => {
      toast.success('Phase removed');
      void invalidate();
    },
    onError: () => toast.error('Failed to remove phase'),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { phaseId: string; status: PhaseStatus }) =>
      updatePhaseStatus(projectId, vars.phaseId, { status: vars.status }),
    onSuccess: () => {
      toast.success('Phase status updated');
      void invalidate();
    },
    onError: () => toast.error('Failed to update phase status'),
  });

  const reorderMutation = useMutation({
    mutationFn: (phaseIds: string[]) =>
      reorderPhases(projectId, { phase_ids: phaseIds }),
    onSuccess: () => {
      void invalidate();
    },
    onError: () => {
      toast.error('Failed to reorder phases');
      void invalidate(); // refetch to revert local state
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = phases.findIndex((p) => p.id === String(active.id));
    const newIndex = phases.findIndex((p) => p.id === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(phases, oldIndex, newIndex);
    reorderMutation.mutate(next.map((p) => p.id));
  }

  return (
    <section
      aria-labelledby="phases-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="phases-heading" className="text-lg font-semibold">
          Phases
        </h2>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            data-testid="phases-add-toggle"
          >
            {showAdd ? 'Cancel' : 'Add phase'}
          </button>
        )}
      </header>

      {showAdd && canWrite && (
        <form
          className="grid gap-3 rounded-md border border-border bg-bg-muted p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(draft);
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="phase-name" className="text-xs uppercase tracking-wide text-fg-subtle">
              Name
            </label>
            <input
              id="phase-name"
              type="text"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="phase-name-input"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="phase-position"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Position
            </label>
            <input
              id="phase-position"
              type="number"
              min={0}
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label
              htmlFor="phase-description"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Description
            </label>
            <textarea
              id="phase-description"
              rows={2}
              value={draft.description ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value === '' ? null : e.target.value })
              }
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="phase-budget"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Budget
            </label>
            <MoneyInput
              id="phase-budget"
              value={typeof draft.budget_cents === 'number' ? draft.budget_cents : 0}
              onChange={(c) => setDraft({ ...draft, budget_cents: c })}
              currency={currency}
            />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Saving…' : 'Add phase'}
            </button>
          </div>
        </form>
      )}

      {phases.length === 0 ? (
        <p className="text-sm text-fg-muted">No phases yet. Add the first phase above.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={phases.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="flex flex-col gap-2">
              {phases.map((phase) => (
                <PhaseRow
                  key={phase.id}
                  phase={phase}
                  canWrite={canWrite}
                  currency={currency}
                  onPatch={(patch) => patchMutation.mutate({ phaseId: phase.id, patch })}
                  onDelete={() => deleteMutation.mutate(phase.id)}
                  onStatus={(status) => statusMutation.mutate({ phaseId: phase.id, status })}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

interface RowProps {
  phase: ProjectPhase;
  canWrite: boolean;
  currency: string;
  onPatch: (patch: ProjectPhasePatch) => void;
  onDelete: () => void;
  onStatus: (status: PhaseStatus) => void;
}

function PhaseRow({ phase, canWrite, currency, onPatch, onDelete, onStatus }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: phase.id,
    disabled: !canWrite,
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(phase.name);
  const [description, setDescription] = useState(phase.description ?? '');
  const [budgetCents, setBudgetCents] = useState<number>(
    typeof phase.budget_cents === 'number' ? phase.budget_cents : Number(phase.budget_cents),
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function commit() {
    const patch: ProjectPhasePatch = {};
    if (name !== phase.name) patch.name = name;
    const nextDesc = description === '' ? null : description;
    if (nextDesc !== phase.description) patch.description = nextDesc;
    const currentBudget =
      typeof phase.budget_cents === 'number' ? phase.budget_cents : Number(phase.budget_cents);
    if (budgetCents !== currentBudget) patch.budget_cents = budgetCents;
    if (Object.keys(patch).length > 0) onPatch(patch);
    setEditing(false);
  }

  const showStart = canWrite && canTransition('phase', phase.status, 'active');
  const showComplete = canWrite && canTransition('phase', phase.status, 'completed');
  const showCancel =
    canWrite && phase.status !== 'cancelled' && canTransition('phase', phase.status, 'cancelled');

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`phase-row-${phase.id}`}
      className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="cursor-grab rounded p-1 text-fg-muted hover:text-fg"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <span className="inline-block w-6" aria-hidden />
        )}
        <span className="font-mono text-xs text-fg-subtle">#{phase.position}</span>
        {editing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-fg">{phase.name}</span>
        )}
        <PhaseStatusBadge status={phase.status} />
      </div>

      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Description"
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">Budget</span>
            <MoneyInput value={budgetCents} onChange={setBudgetCents} currency={currency} />
          </div>
        </div>
      ) : (
        <dl className="grid gap-1 text-xs text-fg-muted sm:grid-cols-4">
          <div>
            <dt className="uppercase tracking-wide text-fg-subtle">Planned start</dt>
            <dd>{formatDate(phase.planned_start_at)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-fg-subtle">Planned end</dt>
            <dd>{formatDate(phase.planned_end_at)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-fg-subtle">Actual start</dt>
            <dd>{formatDate(phase.actual_start_at)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-fg-subtle">Actual end</dt>
            <dd>{formatDate(phase.actual_end_at)}</dd>
          </div>
        </dl>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={commit}
                className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-brand-fg hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setName(phase.name);
                  setDescription(phase.description ?? '');
                }}
                className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
              data-testid={`phase-edit-${phase.id}`}
            >
              Edit
            </button>
          )}
          {showStart && (
            <button
              type="button"
              onClick={() => onStatus('active')}
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
              data-testid={`phase-start-${phase.id}`}
            >
              Start
            </button>
          )}
          {showComplete && (
            <button
              type="button"
              onClick={() => onStatus('completed')}
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
              data-testid={`phase-complete-${phase.id}`}
            >
              Complete
            </button>
          )}
          {showCancel && (
            <button
              type="button"
              onClick={() => onStatus('cancelled')}
              className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
              data-testid={`phase-cancel-${phase.id}`}
            >
              Cancel phase
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Remove this phase?')) onDelete();
            }}
            aria-label="Delete phase"
            className="ml-auto rounded-md border border-border bg-bg p-1 text-fg-muted hover:bg-bg-muted hover:text-danger"
            data-testid={`phase-delete-${phase.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}
