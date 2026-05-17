/**
 * settingsService numbering routing + wire-shape tests.
 *
 * Regression for R-W11-NUMBERING-01 — Phase 15 originally shipped a
 * `kind`/`pad`/`auto_reset` shape that never matched the prod
 * `numbering_sequences` columns (`doc_type`/`pad_width`/`reset_period`),
 * which 500'd every /settings/numbering load for any non-Team1 tenant.
 * These tests pin the corrected wire shape so any future drift fails CI
 * before it reaches prod.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));

import { apiRequest } from '../../apiClient';
import { listNumbering, updateNumbering } from '../settingsService';

const mock = vi.mocked(apiRequest);

beforeEach(() => {
  mock.mockReset();
});

describe('settingsService numbering routing', () => {
  it('listNumbering GETs /settings-api/settings/numbering and parses the doc_type shape', async () => {
    mock.mockResolvedValueOnce({
      items: [
        {
          doc_type: 'invoice',
          prefix: 'INV-',
          pad_width: 5,
          reset_period: 'yearly',
          current_value: 42,
        },
      ],
    });
    const rows = await listNumbering();
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('GET');
    expect(call?.path).toBe('/settings-api/settings/numbering');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.doc_type).toBe('invoice');
    expect(rows[0]?.pad_width).toBe(5);
    expect(rows[0]?.reset_period).toBe('yearly');
  });

  it('updateNumbering PUTs /settings-api/settings/numbering/:doc_type with the new field names', async () => {
    mock.mockResolvedValueOnce({
      doc_type: 'invoice',
      prefix: 'INV-',
      pad_width: 6,
      reset_period: 'monthly',
      current_value: 0,
    });
    await updateNumbering('invoice', { prefix: 'INV-', pad_width: 6, reset_period: 'monthly' });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('PUT');
    expect(call?.path).toBe('/settings-api/settings/numbering/invoice');
    expect(call?.body).toEqual({ prefix: 'INV-', pad_width: 6, reset_period: 'monthly' });
  });

  it('url-encodes the doc_type path segment', async () => {
    mock.mockResolvedValueOnce({
      doc_type: 'weird/type',
      prefix: 'X-',
      pad_width: 4,
      reset_period: 'never',
      current_value: 0,
    });
    await updateNumbering('weird/type', { prefix: 'X-' });
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/settings-api/settings/numbering/weird%2Ftype');
  });
});
