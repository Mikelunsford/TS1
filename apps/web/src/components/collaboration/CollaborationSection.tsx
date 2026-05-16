/**
 * CollaborationSection — drop-in {Comments | Files} tabbed surface for any
 * entity detail page. The wrapper avoids forcing each detail page to grow
 * its own tabs UI; pages that already have full tabs (e.g.
 * CustomerDetailPage, InvoiceDetailPage) compose the underlying CommentsTab
 * and FilesTab directly.
 *
 * Hides itself when `collaboration.enabled` flag is off (defense-in-depth;
 * the BE bundle is also gated at index.ts).
 *
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 */
import { useState } from 'react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import type { CollabEntityType } from '@/lib/services/collaborationService';

import { CommentsTab } from './CommentsTab';
import { FilesTab } from './FilesTab';

interface Props {
  entityType: CollabEntityType;
  entityId: string;
  /** Optional id prefix to avoid duplicate DOM ids when multiple sections render on one page. */
  idPrefix?: string;
}

type Tab = 'comments' | 'files';

export function CollaborationSection({ entityType, entityId, idPrefix = 'collab' }: Props) {
  const flags = useOrgFlags();
  const enabled = flags.data?.['collaboration.enabled'] !== false;
  const [tab, setTab] = useState<Tab>('comments');

  if (!enabled || !entityId) return null;

  return (
    <section aria-label="Collaboration" className="space-y-3">
      <div className="border-b border-border" role="tablist" aria-label="Collaboration tabs">
        <div className="-mb-px flex gap-1">
          {(['comments', 'files'] as const).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={active}
                aria-controls={`${idPrefix}-${k}`}
                id={`${idPrefix}-tab-${k}`}
                onClick={() => setTab(k)}
                className={
                  'border-b-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand ' +
                  (active
                    ? 'border-brand font-medium text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg')
                }
              >
                {k === 'comments' ? 'Comments' : 'Files'}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={`${idPrefix}-${tab}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${tab}`}
        className="min-h-[6rem]"
      >
        {tab === 'comments' && <CommentsTab entityType={entityType} entityId={entityId} />}
        {tab === 'files' && <FilesTab entityType={entityType} entityId={entityId} />}
      </div>
    </section>
  );
}
