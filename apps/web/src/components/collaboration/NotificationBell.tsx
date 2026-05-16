/**
 * NotificationBell — header dropdown for in-app notifications.
 *
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Polls collaboration-api every 30s. Shows the unread count as a badge,
 * the last 20 notifications in a dropdown, and a "Mark all read" action.
 * Click on an item navigates to the related entity.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { collaborationKeys } from '@/lib/queryKeys/collaboration';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/services/collaborationService';

// Entity-type -> SPA route mapping for "click to navigate".
function routeFor(entityType: string | null | undefined, entityId: string | null | undefined): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'customer':         return `/crm/customers/${entityId}`;
    case 'contact':          return `/crm/contacts`;
    case 'lead':             return `/crm/leads`;
    case 'opportunity':      return `/crm/opportunities`;
    case 'quote':            return `/quotes/${entityId}`;
    case 'project':          return `/projects/${entityId}`;
    case 'invoice':          return `/invoices/${entityId}`;
    case 'payment':          return `/payments/${entityId}`;
    case 'credit_note':      return `/credit-notes/${entityId}`;
    case 'expense':          return `/expenses/${entityId}`;
    case 'purchase_order':   return `/purchase-orders/${entityId}`;
    case 'vendor_bill':      return `/vendor-bills/${entityId}`;
    case 'vendor':           return `/vendors/${entityId}`;
    case 'item':             return `/items/${entityId}`;
    case 'journal_entry':    return `/finance/journal-entries/${entityId}`;
    case 'receiving_order':  return `/receiving/${entityId}`;
    case 'production_run':   return `/production/${entityId}`;
    case 'shipment':         return `/shipments/${entityId}`;
    default:                 return null;
  }
}

function describe(n: AppNotification): string {
  const excerpt = (n.payload as { body_excerpt?: string } | undefined)?.body_excerpt;
  switch (n.event_type) {
    case 'comment.mention':  return excerpt ? `mentioned you: ${excerpt}` : 'mentioned you';
    case 'comment.reply':    return excerpt ? `replied: ${excerpt}` : 'replied to your comment';
    case 'attachment.added': return 'added a file';
    default:                 return n.event_type.replace(/[._]/g, ' ');
  }
}

export function NotificationBell() {
  const flags = useOrgFlags();
  const enabled = flags.data?.['collaboration.enabled'] !== false;

  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const query = useQuery({
    queryKey: collaborationKeys.notifications(false),
    queryFn: () => listNotifications({ limit: 20 }),
    refetchInterval: 30_000,
    enabled,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: collaborationKeys.all }),
  });
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: collaborationKeys.all }),
  });

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!enabled) return null;

  const items = query.data?.items ?? [];
  const unread = query.data?.unread_count ?? 0;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative rounded-md p-1.5 hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <Bell className="h-5 w-5 text-fg-muted" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold text-bg"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-border bg-bg shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={unread === 0 || markAll.isPending}
              className="text-xs text-brand hover:underline disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-fg-muted">
                You&apos;re all caught up.
              </li>
            )}
            {items.map((n) => {
              const target = routeFor(n.entity_type, n.entity_id);
              const isUnread = n.read_at == null;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isUnread) markRead.mutate(n.id);
                      setOpen(false);
                      if (target) navigate(target);
                    }}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-bg-subtle ${isUnread ? 'bg-bg-subtle/30' : ''}`}
                  >
                    <span className="text-xs text-fg-subtle">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                    <span className="text-sm text-fg">{describe(n)}</span>
                    {n.entity_type && (
                      <span className="text-xs text-fg-muted">
                        on {n.entity_type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
