/**
 * Contacts service. Wraps the crm-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §3.2.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import { ContactSchema, type Contact, type ContactUpsert } from '../types';

const ContactListSchema = z.object({
  items: z.array(ContactSchema),
  next_cursor: z.string().nullable(),
});

const DeleteResultSchema = z.object({ ok: z.literal(true) });

export interface ContactListFilters {
  customer_id?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ContactListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listContacts(filters?: ContactListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/contacts${toQuery(filters)}`,
    schema: ContactListSchema,
  });
}

export function getContact(id: string): Promise<Contact> {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/contacts/${id}`,
    schema: ContactSchema,
  });
}

export function createContact(body: ContactUpsert): Promise<Contact> {
  return apiRequest({
    method: 'POST',
    path: '/crm-api/contacts',
    body,
    schema: ContactSchema,
  });
}

export function updateContact(id: string, body: Partial<ContactUpsert>): Promise<Contact> {
  return apiRequest({
    method: 'PATCH',
    path: `/crm-api/contacts/${id}`,
    body,
    schema: ContactSchema,
  });
}

export function deleteContact(id: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/crm-api/contacts/${id}`,
    body: {},
    schema: DeleteResultSchema,
  });
}
