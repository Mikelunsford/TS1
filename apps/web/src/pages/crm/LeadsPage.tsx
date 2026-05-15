/**
 * LeadsPage — list vs. kanban toggle. View state lives in `?view=` URL param
 * so each shape is bookmarkable. Filter chips above: status, source,
 * assigned_to. (Wave 2 dispatch references `<AssignedToPicker>` from FE-A;
 * that file ships on a parallel branch, so this page uses a plain user_id
 * input for now and is wired to swap in the picker on rebase.)
 *
 * See TS1/11-modules/03-BUILD-ORDER.md Phase 2.
 */
import { useMemo, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ConvertLeadDialog } from '@/components/crm/ConvertLeadDialog';
import { LeadKanban } from '@/components/crm/LeadKanban';
import { LeadStatusBadge } from '@/components/crm/LeadStatusBadge';
import { cn } from '@/lib/cn';
import {
  LEAD_STATUS_VALUES,
  type Lead,
  type LeadListFilters,
  type LeadStatus,
} from '@/lib/crmTypes';
import { formatDate } from '@/lib/formatDate';
import { leadKeys } from '@/lib/queryKeys/leads';
import { listLeads, updateLead } from '@/lib/services/leadsService';

type View = 'list' | 'kanban';

const LEAD_SOURCES = ['inbound', 'outbound', 'referral', 'event', 'import', 'other'] as const;

export default function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'kanban' ? 'kanban' : 'list';

  const statusParam = params.get('status');
  const sourceParam = params.get('source');
  const assignedToParam = params.get('assigned_to');

  const filters = useMemo<LeadListFilters>(() => {
    const f: LeadListFilters = {};
    if (statusParam && (LEAD_STATUS_VALUES as readonly string[]).includes(statusParam)) {
      f.status = statusParam as LeadStatus;
    }
    if (sourceParam && (LEAD_SOURCES as readonly string[]).includes(sourceParam)) {
      f.source = sourceParam as (typeof LEAD_SOURCES)[number];
    }
    if (assignedToParam) {
      f.assigned_to = assignedToParam;
    }
    return f;
  }, [statusParam, sourceParam, assignedToParam]);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: () => listLeads(filters),
  });

  const setView = (next: View) => {
    const sp = new URLSearchParams(params);
    sp.set('view', next);
    setParams(sp, { replace: true });
  };

  const setFilter = (key: 'status' | 'source' | 'assigned_to', value: string | null) => {
    const sp = new URLSearchParams(params);
    if (value === null || value === '') {
      sp.delete(key);
    } else {
      sp.set(key, value);
    }
    setParams(sp, { replace: true });
  };

  const [convertTarget, setConvertTarget] = useState<Lead | null>(null);

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-xl font-semibold text-fg">Leads</h1>
        <div role="tablist" aria-label="View" className="flex gap-1 p-0.5 rounded bg-bg-subtle">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'list'}
            onClick={() => setView('list')}
            className={cn(
              'px-3 py-1 rounded text-sm',
              view === 'list' ? 'bg-bg text-fg shadow' : 'text-fg-muted hover:text-fg',
            )}
          >
            List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'kanban'}
            onClick={() => setView('kanban')}
            className={cn(
              'px-3 py-1 rounded text-sm',
              view === 'kanban' ? 'bg-bg text-fg shadow' : 'text-fg-muted hover:text-fg',
            )}
          >
            Kanban
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
        <select
          aria-label="Filter by status"
          value={statusParam ?? ''}
          onChange={(e) => setFilter('status', e.target.value || null)}
          className="px-2 py-1 rounded border border-border bg-bg text-sm text-fg"
        >
          <option value="">All statuses</option>
          {LEAD_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by source"
          value={sourceParam ?? ''}
          onChange={(e) => setFilter('source', e.target.value || null)}
          className="px-2 py-1 rounded border border-border bg-bg text-sm text-fg"
        >
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Filter by assigned user id"
          placeholder="Assigned to (user id)"
          value={assignedToParam ?? ''}
          onChange={(e) => setFilter('assigned_to', e.target.value || null)}
          className="px-2 py-1 rounded border border-border bg-bg text-sm text-fg w-72"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-fg-muted">Loading leads…</div>
        ) : view === 'kanban' ? (
          <LeadKanban leads={leads} onConvert={setConvertTarget} />
        ) : (
          <LeadsTable leads={leads} onConvert={setConvertTarget} />
        )}
      </div>

      <ConvertLeadDialog
        lead={convertTarget}
        open={convertTarget !== null}
        onClose={() => setConvertTarget(null)}
      />
    </div>
  );
}

/**
 * Minimal table. The dispatch references TanStack Table; that dep is not in
 * the lockfile yet — Wave 3 design-system bootstrap. Plain table renders the
 * same columns and lets sort/filter live in URL params for now.
 */
function LeadsTable({
  leads,
  onConvert,
}: {
  leads: Lead[];
  onConvert: (lead: Lead) => void;
}) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: LeadStatus }) =>
      updateLead({ id: vars.id, status: vars.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
    onError: () => toast.error('Failed to update lead'),
  });

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-fg-muted uppercase">
        <tr className="border-b border-border">
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Status</th>
          <th className="px-4 py-2">Source</th>
          <th className="px-4 py-2">Email</th>
          <th className="px-4 py-2">Created</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {leads.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
              No leads.
            </td>
          </tr>
        ) : (
          leads.map((lead) => (
            <tr key={lead.id} className="border-b border-border hover:bg-bg-subtle">
              <td className="px-4 py-2 font-medium text-fg">{lead.display_name}</td>
              <td className="px-4 py-2">
                <LeadStatusBadge status={lead.status} />
              </td>
              <td className="px-4 py-2 text-fg-muted">{lead.source}</td>
              <td className="px-4 py-2 text-fg-muted">{lead.primary_email ?? '—'}</td>
              <td className="px-4 py-2 text-fg-muted">{formatDate(lead.created_at)}</td>
              <td className="px-4 py-2 text-right">
                {lead.status === 'qualified' ? (
                  <button
                    type="button"
                    onClick={() => onConvert(lead)}
                    className="px-2 py-1 rounded text-xs font-medium bg-brand text-brand-fg hover:opacity-90"
                  >
                    Convert
                  </button>
                ) : lead.status !== 'converted' && lead.status !== 'disqualified' ? (
                  <button
                    type="button"
                    onClick={() =>
                      statusMutation.mutate({
                        id: lead.id,
                        status: lead.status === 'new' ? 'contacted' : 'qualified',
                      })
                    }
                    className="px-2 py-1 rounded text-xs border border-border text-fg hover:bg-bg-subtle"
                  >
                    Advance
                  </button>
                ) : null}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
