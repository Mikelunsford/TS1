/**
 * Journal entries service (Wave 8 / Phase 12). Wraps finance-api's 6 JE
 * routes. Workflow:
 *   draft → posted (asserts balance via check_journal_balance RPC)
 *   draft|posted → reversed (creates flipped mirror entry)
 *
 * GET :id joins lines; the response shape is `JournalEntry & { lines: [] }`.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  JournalEntryLineSchema,
  JournalEntrySchema,
  type JournalEntry,
  type JournalEntryCreate,
  type JournalEntryLine,
  type JournalEntryPatch,
  type JournalEntryReverse,
  type JournalEntrySourceType,
} from '../types';

const JournalEntryListSchema = z.object({
  items: z.array(JournalEntrySchema),
  next_cursor: z.string().nullable().optional(),
});

/** Joined detail shape from `GET /journal-entries/:id`. */
export const JournalEntryWithLinesSchema = JournalEntrySchema.extend({
  lines: z.array(JournalEntryLineSchema),
});
export type JournalEntryWithLines = z.infer<typeof JournalEntryWithLinesSchema>;

export interface JournalEntryListFilters {
  status?: string;
  source_type?: JournalEntrySourceType;
  source_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: JournalEntryListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.source_type) sp.set('source_type', filters.source_type);
  if (filters.source_id) sp.set('source_id', filters.source_id);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listJournalEntries(filters?: JournalEntryListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/journal-entries${toQuery(filters)}`,
    schema: JournalEntryListSchema,
  });
}

export function getJournalEntry(id: string): Promise<JournalEntryWithLines> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/journal-entries/${id}`,
    schema: JournalEntryWithLinesSchema,
  });
}

export function createJournalEntry(body: JournalEntryCreate): Promise<JournalEntry> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/journal-entries',
    body,
    schema: JournalEntrySchema,
  });
}

export function updateJournalEntry(
  id: string,
  body: JournalEntryPatch,
): Promise<JournalEntry> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/journal-entries/${id}`,
    body,
    schema: JournalEntrySchema,
  });
}

export function postJournalEntry(id: string): Promise<JournalEntry> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/journal-entries/${id}/post`,
    body: {},
    schema: JournalEntrySchema,
  });
}

export function reverseJournalEntry(
  id: string,
  body: JournalEntryReverse = {},
): Promise<JournalEntry> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/journal-entries/${id}/reverse`,
    body,
    schema: JournalEntrySchema,
  });
}

/** Sum debit/credit cents on an in-memory line array (for balance preview). */
export function sumLines(lines: ReadonlyArray<{ debit_cents: number; credit_cents: number }>) {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += l.debit_cents;
    credit += l.credit_cents;
  }
  return { debit, credit, balanced: debit === credit, diff: debit - credit };
}

export type { JournalEntryLine };
