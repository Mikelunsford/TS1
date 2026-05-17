/**
 * Contacts query keys (CRM / Wave 2). Created for the detail page —
 * Wave-2 leads/opportunities each got their own queryKeys file at FE-B
 * shipping time; contacts didn't because no detail surface consumed it
 * until R-W10-S2-B1-OBS-02.
 */
import type { ContactListFilters } from '../services/contactsService';

export const contactKeys = {
  all: ['crm', 'contacts'] as const,
  list: (filters: ContactListFilters = {}) => [...contactKeys.all, 'list', filters] as const,
  detail: (id: string) => [...contactKeys.all, 'detail', id] as const,
};
