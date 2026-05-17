/**
 * receivingOrdersService routing tests. Wave 8f / Phase 13.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));

import { apiRequest } from '../../apiClient';
import {
  cancelReceivingOrder,
  createReceivingOrder,
  getReceivingOrder,
  listReceivingOrders,
  receiveReceivingOrder,
  updateReceivingOrder,
} from '../receivingOrdersService';

const mock = vi.mocked(apiRequest);

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue({ items: [], next_cursor: null });
});

describe('receivingOrdersService routing', () => {
  it('listReceivingOrders GETs /ops-api/receiving-orders', () => {
    void listReceivingOrders({ status: 'open', project_id: 'p1' });
    const path = mock.mock.calls[0]?.[0]?.path ?? '';
    expect(path.startsWith('/ops-api/receiving-orders?')).toBe(true);
    expect(path).toContain('status=open');
    expect(path).toContain('project_id=p1');
  });

  it('getReceivingOrder hits /:id', () => {
    void getReceivingOrder('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/receiving-orders/abc');
  });

  // R-W8F-OBS-03 — expand pass-through.
  it('getReceivingOrder appends ?expand=project when requested', () => {
    void getReceivingOrder('abc', { expand: ['project'] });
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/receiving-orders/abc?expand=project');
  });

  it('createReceivingOrder POSTs the body', () => {
    void createReceivingOrder({
      project_id: 'p1',
      source: 't1_purchase',
      expected_qty: 10,
    });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/ops-api/receiving-orders');
    expect(call?.body).toMatchObject({ project_id: 'p1', expected_qty: 10 });
  });

  it('updateReceivingOrder PATCHes /:id', () => {
    void updateReceivingOrder('abc', { vendor: 'Acme' });
    expect(mock.mock.calls[0]?.[0]?.method).toBe('PATCH');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/receiving-orders/abc');
  });

  it('receiveReceivingOrder POSTs /:id/receive with absolute cumulative qty', () => {
    void receiveReceivingOrder('abc', { received_qty: 5 });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/ops-api/receiving-orders/abc/receive');
    expect(call?.body).toEqual({ received_qty: 5 });
  });

  it('cancelReceivingOrder POSTs /:id/cancel', () => {
    void cancelReceivingOrder('abc');
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/ops-api/receiving-orders/abc/cancel');
  });

  it('propagates errors from the underlying apiRequest', async () => {
    mock.mockRejectedValueOnce(new Error('boom'));
    await expect(getReceivingOrder('x')).rejects.toThrow('boom');
  });
});
