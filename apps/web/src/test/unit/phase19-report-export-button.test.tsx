/**
 * Phase 19 (Wave 10 Session 3) — R-W10-RPT-01 close-out.
 *
 * Unit tests for the rewritten <ReportExportButton>. The Wave-10-S1 stub
 * was feature-flag-gated and inert; this version wires straight to the
 * exports-api report endpoints, fetches the CSV, and triggers a download
 * via a synthetic <a download>.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReportExportButton } from '@/components/reports/ReportExportButton';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'fake-jwt' } } }),
    },
  },
}));

describe('<ReportExportButton>', () => {
  it('renders enabled when a known reportKey is provided', () => {
    render(<ReportExportButton reportKey="ar-aging" params={{ as_of: '2026-05-16', currency: 'USD' }} />);
    expect(screen.getByTestId('report-export-ar-aging')).toBeEnabled();
  });

  it('disables itself when reportKey is unknown', () => {
    render(<ReportExportButton reportKey="not-a-real-report" />);
    expect(screen.getByTestId('report-export-not-a-real-report')).toBeDisabled();
  });

  it('fetches the report CSV and triggers a download on click', async () => {
    const originalFetch = globalThis.fetch;
    // jsdom doesn't implement URL.createObjectURL / revokeObjectURL.
    const ucCreate = URL.createObjectURL;
    const ucRevoke = URL.revokeObjectURL;
    (URL as { createObjectURL: unknown }).createObjectURL = () => 'blob:fake';
    (URL as { revokeObjectURL: unknown }).revokeObjectURL = () => undefined;

    const blob = new Blob(['customer_id,total\nC1,100\n'], { type: 'text/csv' });
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="ar-aging-2026-05-16.csv"' },
      }),
    );
    globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    render(<ReportExportButton reportKey="ar-aging" params={{ as_of: '2026-05-16', currency: 'USD' }} />);
    fireEvent.click(screen.getByTestId('report-export-ar-aging'));
    await waitFor(() => expect(fakeFetch).toHaveBeenCalled());
    const url = (fakeFetch.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toContain('/exports-api/exports/reports/ar-aging');
    expect(url).toContain('as_of=2026-05-16');
    expect(url).toContain('currency=USD');
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    createSpy.mockRestore();
    globalThis.fetch = originalFetch;
    (URL as { createObjectURL: unknown }).createObjectURL = ucCreate;
    (URL as { revokeObjectURL: unknown }).revokeObjectURL = ucRevoke;
  });
});
