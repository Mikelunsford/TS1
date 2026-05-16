/**
 * pdf-worker — POST /pdf/render
 *
 * Body: { entity_type: 'invoice' | 'quote' | 'payment', entity_id: uuid }
 * Returns: { signed_url, expires_at, file_path }
 *
 * 1. Cap-check `pdf.render`.
 * 2. Load org_branding for the caller's org.
 * 3. Load entity + child rows (lines / payment context).
 * 4. Render via pdf-lib template.
 * 5. Upload to `pdfs` bucket at <org_id>/<entity_type>/<entity_id>/<ts>.pdf.
 * 6. createSignedUrl (24h) and return.
 *
 * Cold-start risk (R-35 in the risk register): pdf-lib ships ~150 kB JS
 * + the standard 14 fonts; first invocation can take ~3-5s. We wrap the
 * render in a 30s timeout and return 504 with `{retryable: true}` if hit.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';
import { RenderPdfSchema, type RenderEntityType } from '../schemas.ts';
import {
  renderInvoicePdf,
  renderQuotePdf,
  renderPaymentReceiptPdf,
  type InvoiceLikeData,
  type LineItem,
  type OrgBranding,
  type PaymentReceiptData,
} from '../templates/common.ts';

const BUCKET = 'pdfs';
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const RENDER_TIMEOUT_MS = 30_000;

interface BrandingRow {
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  invoice_pdf_footer: string | null;
  quote_pdf_footer: string | null;
}

async function loadBranding(orgId: string): Promise<OrgBranding> {
  const sb = admin();
  const [{ data: org, error: orgErr }, { data: brand, error: brandErr }] = await Promise.all([
    sb.from('organizations').select('display_name, name').eq('id', orgId).maybeSingle() as unknown as Promise<{ data: { display_name?: string; name?: string } | null; error: { message: string } | null }>,
    sb.from('org_branding').select('logo_url, primary_color, accent_color, invoice_pdf_footer, quote_pdf_footer').eq('org_id', orgId).maybeSingle() as unknown as Promise<{ data: BrandingRow | null; error: { message: string } | null }>,
  ]);
  if (orgErr) {
    throw new ApiError('INTERNAL_ERROR', 'org lookup failed', 500, { detail: orgErr.message });
  }
  if (brandErr) {
    throw new ApiError('INTERNAL_ERROR', 'org_branding lookup failed', 500, { detail: brandErr.message });
  }
  const orgName = org?.display_name ?? org?.name ?? 'Team1';
  return {
    org_name: orgName,
    logo_url: brand?.logo_url ?? null,
    primary_color: brand?.primary_color ?? '#0F172A',
    accent_color: brand?.accent_color ?? '#3B82F6',
    invoice_pdf_footer: brand?.invoice_pdf_footer ?? null,
    quote_pdf_footer: brand?.quote_pdf_footer ?? null,
  };
}

interface InvoiceRow {
  id: string;
  org_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  currency_code: string;
  customer_name: string | null;
  notes: string | null;
  subtotal_cents: number;
  tax_total_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
}

interface InvoiceLineRow {
  description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

async function loadInvoiceData(orgId: string, id: string): Promise<InvoiceLikeData> {
  const sb = admin();
  const { data: inv, error: ei } = await sb
    .from('invoices')
    .select('id, org_id, invoice_number, issue_date, due_date, currency_code, customer_name, notes, subtotal_cents, tax_total_cents, total_cents, paid_cents, balance_cents')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle() as unknown as { data: InvoiceRow | null; error: { message: string } | null };
  if (ei) throw new ApiError('INTERNAL_ERROR', 'invoice lookup failed', 500, { detail: ei.message });
  if (!inv) throw new ApiError('NOT_FOUND', 'invoice not found', 404);

  const { data: linesRaw, error: el } = await sb
    .from('invoice_line_items')
    .select('description, quantity, unit_price_cents, line_total_cents')
    .eq('invoice_id', id)
    .order('position', { ascending: true });
  if (el) throw new ApiError('INTERNAL_ERROR', 'invoice lines lookup failed', 500, { detail: el.message });
  const lines: LineItem[] = ((linesRaw ?? []) as InvoiceLineRow[]).map((l) => ({
    description: l.description ?? '',
    quantity: Number(l.quantity ?? 0),
    unit_price_cents: Number(l.unit_price_cents ?? 0),
    line_total_cents: Number(l.line_total_cents ?? 0),
  }));

  return {
    number: inv.invoice_number,
    date: inv.issue_date,
    due_date: inv.due_date,
    currency_code: inv.currency_code,
    customer_name: inv.customer_name ?? '(no name)',
    customer_address: null,
    notes: inv.notes,
    lines,
    subtotal_cents: Number(inv.subtotal_cents ?? 0),
    tax_cents: Number(inv.tax_total_cents ?? 0),
    total_cents: Number(inv.total_cents ?? 0),
    paid_cents: Number(inv.paid_cents ?? 0),
    balance_cents: Number(inv.balance_cents ?? 0),
  };
}

interface QuoteRow {
  id: string;
  org_id: string;
  quote_number: string;
  issue_date: string;
  expiry_date: string | null;
  currency_code: string;
  customer_name: string | null;
  notes: string | null;
  subtotal_cents: number;
  tax_total_cents: number;
  total_cents: number;
}

interface QuoteLineRow {
  description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

async function loadQuoteData(orgId: string, id: string): Promise<InvoiceLikeData> {
  const sb = admin();
  const { data: q, error: e1 } = await sb
    .from('quotes')
    .select('id, org_id, quote_number, issue_date, expiry_date, currency_code, customer_name, notes, subtotal_cents, tax_total_cents, total_cents')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle() as unknown as { data: QuoteRow | null; error: { message: string } | null };
  if (e1) throw new ApiError('INTERNAL_ERROR', 'quote lookup failed', 500, { detail: e1.message });
  if (!q) throw new ApiError('NOT_FOUND', 'quote not found', 404);

  const { data: linesRaw, error: el } = await sb
    .from('quote_line_items')
    .select('description, quantity, unit_price_cents, line_total_cents')
    .eq('quote_id', id)
    .order('position', { ascending: true });
  if (el) throw new ApiError('INTERNAL_ERROR', 'quote lines lookup failed', 500, { detail: el.message });
  const lines: LineItem[] = ((linesRaw ?? []) as QuoteLineRow[]).map((l) => ({
    description: l.description ?? '',
    quantity: Number(l.quantity ?? 0),
    unit_price_cents: Number(l.unit_price_cents ?? 0),
    line_total_cents: Number(l.line_total_cents ?? 0),
  }));

  return {
    number: q.quote_number,
    date: q.issue_date,
    due_date: q.expiry_date,
    currency_code: q.currency_code,
    customer_name: q.customer_name ?? '(no name)',
    customer_address: null,
    notes: q.notes,
    lines,
    subtotal_cents: Number(q.subtotal_cents ?? 0),
    tax_cents: Number(q.tax_total_cents ?? 0),
    total_cents: Number(q.total_cents ?? 0),
  };
}

interface PaymentRow {
  id: string;
  org_id: string;
  payment_number: string | null;
  payment_date: string;
  currency_code: string;
  amount_cents: number;
  reference: string | null;
  notes: string | null;
  customer_id: string;
  invoice_id: string | null;
}

async function loadPaymentReceiptData(orgId: string, id: string): Promise<PaymentReceiptData> {
  const sb = admin();
  const { data: p, error: ep } = await sb
    .from('payments')
    .select('id, org_id, payment_number, payment_date, currency_code, amount_cents, reference, notes, customer_id, invoice_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle() as unknown as { data: PaymentRow | null; error: { message: string } | null };
  if (ep) throw new ApiError('INTERNAL_ERROR', 'payment lookup failed', 500, { detail: ep.message });
  if (!p) throw new ApiError('NOT_FOUND', 'payment not found', 404);

  const { data: cust } = await sb
    .from('customers')
    .select('display_name')
    .eq('id', p.customer_id)
    .maybeSingle() as unknown as { data: { display_name: string | null } | null };

  let invoice_number: string | null = null;
  if (p.invoice_id) {
    const { data: inv } = await sb
      .from('invoices')
      .select('invoice_number')
      .eq('id', p.invoice_id)
      .maybeSingle() as unknown as { data: { invoice_number: string | null } | null };
    invoice_number = inv?.invoice_number ?? null;
  }

  return {
    number: p.payment_number ?? p.id.slice(0, 8),
    date: p.payment_date,
    currency_code: p.currency_code,
    customer_name: cust?.display_name ?? '(unknown customer)',
    customer_address: null,
    payment_method: null,
    reference: p.reference,
    amount_cents: Number(p.amount_cents ?? 0),
    invoice_number,
    notes: p.notes,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('pdf render timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch((e) => { clearTimeout(t); reject(e); });
  });
}

export async function renderPdf({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'pdf.render');
  const body = await parseBody(req, RenderPdfSchema);

  return respondWithIdempotency(req, caller, 'POST /pdf/render', body, async () => {
    const branding = await loadBranding(caller.orgId);

    let bytes: Uint8Array;
    try {
      bytes = await withTimeout(
        (async () => {
          switch (body.entity_type as RenderEntityType) {
            case 'invoice': {
              const data = await loadInvoiceData(caller.orgId, body.entity_id);
              return await renderInvoicePdf(data, branding);
            }
            case 'quote': {
              const data = await loadQuoteData(caller.orgId, body.entity_id);
              return await renderQuotePdf(data, branding);
            }
            case 'payment': {
              const data = await loadPaymentReceiptData(caller.orgId, body.entity_id);
              return await renderPaymentReceiptPdf(data, branding);
            }
            default:
              throw new ApiError('VALIDATION_ERROR', `Unsupported entity_type '${body.entity_type as string}'`, 422);
          }
        })(),
        RENDER_TIMEOUT_MS,
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'pdf render timeout') {
        // 504 with retryable hint.
        throw new ApiError('INTERNAL_ERROR', 'pdf render timed out', 504, { retryable: true });
      }
      throw new ApiError('INTERNAL_ERROR', 'pdf render failed', 500, { detail: msg });
    }

    // Upload.
    const ts = Date.now();
    const filePath = `${caller.orgId}/${body.entity_type}/${body.entity_id}/${ts}.pdf`;
    const sb = admin();
    const { error: upErr } = await sb.storage.from(BUCKET).upload(filePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upErr) {
      throw new ApiError('INTERNAL_ERROR', 'pdf upload failed', 500, { detail: upErr.message });
    }

    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) {
      throw new ApiError('INTERNAL_ERROR', 'signed url failed', 500, { detail: signErr?.message });
    }

    const expires_at = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
    return {
      status: 200,
      body: {
        data: {
          signed_url: signed.signedUrl,
          file_path: filePath,
          bucket: BUCKET,
          expires_at,
          bytes_length: bytes.length,
        },
      },
    };
  });
}

export async function listTemplates({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'pdf.render');
  return ok({
    templates: [
      { id: 'invoice',  description: 'Invoice with totals and balance' },
      { id: 'quote',    description: 'Quote with totals' },
      { id: 'payment',  description: 'Payment receipt' },
    ],
  }, undefined, { req });
}
