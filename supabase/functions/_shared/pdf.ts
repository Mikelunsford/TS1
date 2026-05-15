/**
 * PDF rendering surface.
 *
 * Wave 0 placeholder. The real implementation in Wave 3 wraps `pdf-lib`
 * plus `@pdf-lib/fontkit` per TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §0
 * ("PDF rendering" lock-in). Bundle-specific composition (invoice header,
 * line item table, totals block) lives in the owning bundle's
 * `pdf-template.ts`, not here.
 */

export interface RenderPdfOptions {
  template: string; // e.g. 'invoice' | 'quote' | 'purchase-order'
  data: Record<string, unknown>;
  branding?: Record<string, unknown>;
}

export async function renderPdf(_opts: RenderPdfOptions): Promise<Uint8Array> {
  throw new Error('PDF rendering ships in Wave 3');
}

export {};
