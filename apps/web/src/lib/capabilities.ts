/**
 * SPA-side capability mirror. Byte-aligned to the role policy at
 * `supabase/functions/_shared/capabilities.ts`. The server is still the
 * authority — every cap-gated button is also gated on the edge — so this
 * file's only job is to hide buttons the caller cannot use, surfacing UX
 * over a guaranteed-403.
 *
 * Closes F-Wave4-12 (SPA capabilities.ts mirror) carried from Wave 4 BE.
 *
 * Keep this file in step with `_shared/capabilities.ts`. Adding a cap or
 * changing the role policy is a paired edit. The list of caps here covers
 * Wave 2 → Wave 4 surface that the SPA actually gates today; future caps
 * declared in the BE matrix don't need to be enumerated here until a button
 * references them.
 */
import type { Role } from './types';

const READ_SUFFIX = /\.(read)$/;
const WRITE_FAMILY =
  /\.(write|approve|convert|send|close|void|cancel|post|reverse|refund|issue|apply|submit|invite|role_change|pay|receive|create|update|reopen)$/;

/**
 * Returns true if `role` is allowed `cap`. Mirrors `allow()` in
 * `_shared/capabilities.ts`. The closed role enum lives in `lib/types.ts`.
 */
export function can(role: Role | null | undefined, cap: string): boolean {
  if (!role) return false;

  // Owners and admins reach everything.
  if (role === 'org_owner' || role === 'org_admin') return true;

  const isRead = READ_SUFFIX.test(cap);
  const isWriteFamily = WRITE_FAMILY.test(cap);

  switch (role) {
    case 'sales': {
      if (cap.startsWith('crm.')) return true;
      if (cap.startsWith('quotes.')) return true;
      if (cap.startsWith('projects.')) return isRead;
      if (cap.startsWith('inventory.')) return isRead;
      if (cap.startsWith('finance.')) return isRead;
      if (cap.startsWith('vendors.')) return isRead;
      if (cap === 'attachments.read' || cap === 'attachments.write') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return true;
      if (cap.startsWith('exports.')) return isRead;
      return false;
    }
    case 'ops': {
      if (cap.startsWith('inventory.')) return true;
      if (cap.startsWith('projects.')) return true;
      if (cap.startsWith('quotes.')) return isRead;
      if (
        cap.startsWith('receiving.') ||
        cap.startsWith('production.') ||
        cap.startsWith('shipping.')
      )
        return true;
      if (cap.startsWith('purchase_orders.')) return true;
      if (cap.startsWith('vendors.')) return isRead;
      if (cap.startsWith('crm.')) return isRead;
      if (cap.startsWith('finance.')) return isRead;
      if (cap === 'attachments.read' || cap === 'attachments.write') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return true;
      if (cap.startsWith('exports.')) return isRead;
      return false;
    }
    case 'accounting': {
      if (cap.startsWith('finance.')) return true;
      if (cap.startsWith('invoices.')) return true;
      if (cap.startsWith('payments.')) return true;
      if (cap.startsWith('credit_notes.')) return true;
      if (cap.startsWith('expenses.')) return true;
      if (cap.startsWith('vendor_bills.')) return true;
      if (cap.startsWith('purchase_orders.')) return isRead;
      if (cap.startsWith('vendors.')) return isRead;
      if (cap.startsWith('quotes.')) return isRead;
      if (cap.startsWith('projects.')) return isRead;
      if (cap.startsWith('crm.')) return isRead;
      if (cap.startsWith('inventory.')) return isRead;
      if (cap === 'attachments.read' || cap === 'attachments.write') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return true;
      if (cap.startsWith('exports.')) return true;
      return false;
    }
    case 'viewer': {
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return isRead;
      return isRead && !isWriteFamily;
    }
    case 'customer_user': {
      if (cap === 'notifications.read') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'attachments.read') return true;
      if (cap === 'views.saved.read') return true;
      if (cap.startsWith('crm.customers.') && isRead) return true;
      if (cap.startsWith('crm.contacts.') && isRead) return true;
      if (cap.startsWith('quotes.') && isRead) return true;
      if (cap === 'quotes.write') return true;
      if (cap.startsWith('projects.') && isRead) return true;
      if (cap.startsWith('invoices.') && isRead) return true;
      if (cap.startsWith('payments.') && isRead) return true;
      if (cap.startsWith('credit_notes.') && isRead) return true;
      return false;
    }
    default:
      return false;
  }
}
