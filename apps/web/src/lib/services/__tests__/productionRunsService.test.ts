/**
 * productionRunsService routing tests. Wave 8f / Phase 13.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));

import { apiRequest } from '../../apiClient';
import {
  cancelProductionRun,
  completeProductionRun,
  createProductionRun,
  getProductionRun,
  listProductionRuns,
  startProductionRun,
  updateProductionRun,
} from '../productionRunsService';

const mock = vi.mocked(apiRequest);

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue({ items: [], next_cursor: null });
});

describe('productionRunsService routing', () => {
  it('listProductionRuns GETs /ops-api/production-runs', () => {
    void listProductionRuns({ status: 'scheduled' });
    const path = mock.mock.calls[0]?.[0]?.path ?? '';
    expect(path).toContain('/ops-api/production-runs');
    expect(path).toContain('status=scheduled');
  });

  it('getProductionRun hits /:id', () => {
    void getProductionRun('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/production-runs/abc');
  });

  it('createProductionRun POSTs the body', () => {
    void createProductionRun({ project_id: 'p1', qty_target: 100 });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/ops-api/production-runs');
    expect(call?.body).toMatchObject({ qty_target: 100 });
  });

  it('updateProductionRun PATCHes', () => {
    void updateProductionRun('abc', { qty_target: 200 });
    expect(mock.mock.calls[0]?.[0]?.method).toBe('PATCH');
  });

  it('startProductionRun POSTs /:id/start', () => {
    void startProductionRun('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/production-runs/abc/start');
  });

  it('completeProductionRun POSTs /:id/complete', () => {
    void completeProductionRun('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/production-runs/abc/complete');
  });

  it('cancelProductionRun POSTs /:id/cancel', () => {
    void cancelProductionRun('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/production-runs/abc/cancel');
  });

  it('propagates errors from the underlying apiRequest', async () => {
    mock.mockRejectedValueOnce(new Error('boom'));
    await expect(startProductionRun('x')).rejects.toThrow('boom');
  });
});
