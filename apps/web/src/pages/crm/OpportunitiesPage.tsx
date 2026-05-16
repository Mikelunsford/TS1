/**
 * OpportunitiesPage — same list-vs-kanban toggle as LeadsPage, but the kanban
 * footer per column shows the weighted total
 * (amount_cents × probability_pct / 100). View state lives in `?view=`.
 *
 * See TS1/11-modules/03-BUILD-ORDER.md Phase 2.
 */
import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { OpportunityKanban } from '@/components/crm/OpportunityKanban';
import { OpportunityStageBadge } from '@/components/crm/OpportunityStageBadge';
import { ExportButton } from '@/components/exports/ExportButton';
import { cn } from '@/lib/cn';
import { OpportunityStageSchema, type Opportunity } from '@/lib/types';
import { formatDate } from '@/lib/formatDate';
import { formatMoney } from '@/lib/money';
import { opportunityKeys } from '@/lib/queryKeys/opportunities';
import {
  listOpportunities,
  type OpportunityListFilters,
} from '@/lib/services/opportunitiesService';

const OPPORTUNITY_STAGE_VALUES = OpportunityStageSchema.options;

type View = 'list' | 'kanban';

export default function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'kanban' ? 'kanban' : 'list';

  const stageParam = params.get('stage');
  const ownerParam = params.get('owner');

  const filters = useMemo<OpportunityListFilters>(() => {
    const f: OpportunityListFilters = {};
    if (stageParam && (OPPORTUNITY_STAGE_VALUES as readonly string[]).includes(stageParam)) {
      f.stage = stageParam;
    }
    if (ownerParam) f.owner = ownerParam;
    return f;
  }, [stageParam, ownerParam]);

  const { data, isLoading } = useQuery({
    queryKey: opportunityKeys.list(filters),
    queryFn: () => listOpportunities(filters),
  });
  const opportunities: Opportunity[] = data?.items ?? [];

  const setView = (next: View) => {
    const sp = new URLSearchParams(params);
    sp.set('view', next);
    setParams(sp, { replace: true });
  };

  const setFilter = (key: 'stage' | 'owner', value: string | null) => {
    const sp = new URLSearchParams(params);
    if (value === null || value === '') {
      sp.delete(key);
    } else {
      sp.set(key, value);
    }
    setParams(sp, { replace: true });
  };

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-xl font-semibold text-fg">Opportunities</h1>
        <div className="flex items-center gap-2">
          <ExportButton entity="opportunities" />
        </div>
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
          aria-label="Filter by stage"
          value={stageParam ?? ''}
          onChange={(e) => setFilter('stage', e.target.value || null)}
          className="px-2 py-1 rounded border border-border bg-bg text-sm text-fg"
        >
          <option value="">All stages</option>
          {OPPORTUNITY_STAGE_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Filter by assigned user id"
          placeholder="Assigned to (user id)"
          value={ownerParam ?? ''}
          onChange={(e) => setFilter('owner', e.target.value || null)}
          className="px-2 py-1 rounded border border-border bg-bg text-sm text-fg w-72"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-fg-muted">Loading opportunities…</div>
        ) : view === 'kanban' ? (
          <OpportunityKanban opportunities={opportunities} />
        ) : (
          <OpportunitiesTable opportunities={opportunities} />
        )}
      </div>
    </div>
  );
}

function OpportunitiesTable({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-fg-muted uppercase">
        <tr className="border-b border-border">
          <th className="px-4 py-2">Number</th>
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Stage</th>
          <th className="px-4 py-2">Amount</th>
          <th className="px-4 py-2">Probability</th>
          <th className="px-4 py-2">Close date</th>
        </tr>
      </thead>
      <tbody>
        {opportunities.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-8 text-center text-fg-muted">
              No opportunities.
            </td>
          </tr>
        ) : (
          opportunities.map((opp) => (
            <tr key={opp.id} className="border-b border-border hover:bg-bg-subtle">
              <td className="px-4 py-2 font-mono text-xs text-fg-muted">{opp.opportunity_number}</td>
              <td className="px-4 py-2 font-medium text-fg">{opp.display_name}</td>
              <td className="px-4 py-2">
                <OpportunityStageBadge stage={opp.stage} />
              </td>
              <td className="px-4 py-2 text-fg">
                {formatMoney(opp.amount_cents, { currency: opp.currency_code ?? 'USD' })}
              </td>
              <td className="px-4 py-2 text-fg-muted">{opp.probability_pct}%</td>
              <td className="px-4 py-2 text-fg-muted">{formatDate(opp.expected_close_date)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
