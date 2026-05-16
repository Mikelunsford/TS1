/**
 * Portal service — wraps customer-portal-api (Phase 21 / Wave 10 Session 4).
 *
 * Schemas are intentionally tolerant `z.object({}).passthrough()` shapes:
 * the BE is the source of truth and the portal pages render mostly raw
 * fields; we keep TS happy without duplicating every column from
 * lib/types.ts.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';

// -------------------------------------------------------------------------
// Common shapes
// -------------------------------------------------------------------------

const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });

const Loose = z.object({}).passthrough();

// -------------------------------------------------------------------------
// /portal/me
// -------------------------------------------------------------------------

export const PortalMeSchema = z.object({
  customer: Loose,
  profile: Loose,
});
export type PortalMe = z.infer<typeof PortalMeSchema>;

export function getPortalMe(): Promise<PortalMe> {
  return apiRequest({
    method: 'GET',
    path: '/customer-portal-api/portal/me',
    schema: PortalMeSchema,
  });
}

// -------------------------------------------------------------------------
// Invoices
// -------------------------------------------------------------------------

export interface PortalInvoiceListFilters {
  status?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
  cursor?: string | undefined;
}

function toQuery(f: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const PortalInvoiceListSchema = PaginatedSchema(Loose);
export type PortalInvoiceListResponse = z.infer<typeof PortalInvoiceListSchema>;

export function listPortalInvoices(filters: PortalInvoiceListFilters = {}) {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/invoices${toQuery({
      status: filters.status,
      page: filters.page,
      page_size: filters.page_size ?? filters.page_size,
      limit: filters.page_size,
      cursor: filters.cursor,
    })}`,
    schema: PortalInvoiceListSchema,
  });
}

export const PortalInvoiceDetailSchema = z.object({
  invoice: Loose,
  lines: z.array(Loose),
  pdf_url: z.string().nullable(),
});
export type PortalInvoiceDetail = z.infer<typeof PortalInvoiceDetailSchema>;

export function getPortalInvoice(id: string): Promise<PortalInvoiceDetail> {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/invoices/${id}`,
    schema: PortalInvoiceDetailSchema,
  });
}

// -------------------------------------------------------------------------
// Quotes
// -------------------------------------------------------------------------

const PortalQuoteListSchema = PaginatedSchema(Loose);
export type PortalQuoteListResponse = z.infer<typeof PortalQuoteListSchema>;

export function listPortalQuotes(filters: { status?: string | undefined; cursor?: string | undefined; page_size?: number | undefined } = {}) {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/quotes${toQuery({
      status: filters.status,
      limit: filters.page_size,
      cursor: filters.cursor,
    })}`,
    schema: PortalQuoteListSchema,
  });
}

export const PortalQuoteDetailSchema = z.object({
  quote: Loose,
  lines: z.array(Loose),
  pdf_url: z.string().nullable(),
});
export type PortalQuoteDetail = z.infer<typeof PortalQuoteDetailSchema>;

export function getPortalQuote(id: string): Promise<PortalQuoteDetail> {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/quotes/${id}`,
    schema: PortalQuoteDetailSchema,
  });
}

// -------------------------------------------------------------------------
// Projects
// -------------------------------------------------------------------------

const PortalProjectListSchema = PaginatedSchema(Loose);
export type PortalProjectListResponse = z.infer<typeof PortalProjectListSchema>;

export function listPortalProjects(filters: { status?: string | undefined; cursor?: string | undefined; page_size?: number | undefined } = {}) {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/projects${toQuery({
      status: filters.status,
      limit: filters.page_size,
      cursor: filters.cursor,
    })}`,
    schema: PortalProjectListSchema,
  });
}

export const PortalProjectDetailSchema = z.object({
  project: Loose,
  phases: z.array(Loose),
});
export type PortalProjectDetail = z.infer<typeof PortalProjectDetailSchema>;

export function getPortalProject(id: string): Promise<PortalProjectDetail> {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/projects/${id}`,
    schema: PortalProjectDetailSchema,
  });
}

// -------------------------------------------------------------------------
// Payments
// -------------------------------------------------------------------------

const PortalPaymentListSchema = PaginatedSchema(Loose);
export type PortalPaymentListResponse = z.infer<typeof PortalPaymentListSchema>;

export function listPortalPayments(filters: { cursor?: string | undefined; page_size?: number | undefined } = {}) {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/payments${toQuery({
      limit: filters.page_size,
      cursor: filters.cursor,
    })}`,
    schema: PortalPaymentListSchema,
  });
}

// -------------------------------------------------------------------------
// Statements
// -------------------------------------------------------------------------

export const PortalStatementSchema = z.object({
  as_of: z.string(),
  currency_code: z.string(),
  aging: z.object({
    customer_id: z.string(),
    customer_name: z.string(),
    current_cents: z.number(),
    days_1_30_cents: z.number(),
    days_31_60_cents: z.number(),
    days_61_90_cents: z.number(),
    days_over_90_cents: z.number(),
    total_cents: z.number(),
  }),
});
export type PortalStatement = z.infer<typeof PortalStatementSchema>;

export function getPortalStatement(opts: { as_of?: string | undefined; currency_code?: string | undefined } = {}): Promise<PortalStatement> {
  return apiRequest({
    method: 'GET',
    path: `/customer-portal-api/portal/statements${toQuery({
      as_of: opts.as_of,
      currency_code: opts.currency_code,
    })}`,
    schema: PortalStatementSchema,
  });
}
